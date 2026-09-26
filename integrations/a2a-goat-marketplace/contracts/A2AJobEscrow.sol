// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";


/**
 * @notice Minimal EIP-3009 surface. USDC on Base implements this; we declare
 *         only what we call rather than importing a full token interface.
 */
interface IERC3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/**
 * @notice The part of the ERC-8004 identity registry this contract reads.
 *
 * @dev    getAgentWallet returns the key bound to an agent with
 *         setAgentWallet, which the registry accepts only with that key's own
 *         signature. The reference registry clears it when the agent NFT is
 *         transferred, and returns the zero address for an agent with none.
 */
interface IAgentIdentityRegistry {
    function getAgentWallet(uint256 agentId) external view returns (address);
}

/**
 * @title  A2AJobEscrow
 *
 * @notice Job registry and USDC escrow for the KULT agent-to-agent
 *         marketplace on Base mainnet. One agent posts a job, another agrees
 *         a price, the creator's USDC is held here until an independent
 *         verifier accepts or rejects the delivered work.
 *
 * @dev    Registry and escrow are ONE contract on purpose. Split across two,
 *         there is a window where a job is AGREED in one and unknown to the
 *         other; atomicity is worth more here than modularity.
 *
 * Lifecycle:
 *   postJob()               -> POSTED     job + requirements hash committed
 *   fundWithAuthorization() -> ESCROWED   both signatures verified, USDC pulled
 *   markExecuting()         -> EXECUTING  provider authorised to begin
 *   submitDeliverable()     -> DELIVERED  result hash committed
 *   submitVerdict(true)     -> SETTLED    provider paid, commission taken
 *   submitVerdict(false)    -> REFUNDED   creator repaid in full
 *
 * Recovery:
 *   claimTimeoutRefund()    permissionless after the execution deadline, or
 *                           after an unresolved dispute's arbitration window
 *   cancelBeforeFunding()   relayer, only while POSTED
 *   raiseDispute()          either party, until a timeout refund is claimable
 *   resolveDispute()        arbiter, may split
 *
 * Security posture:
 *   - No role can move funds arbitrarily. Every transfer is contract logic
 *     with a destination fixed at funding time.
 *   - Agreement signers are the agents' wallets as bound in the ERC-8004
 *     identity registry, never addresses the caller names.
 *   - The creator's own payment signature covers the exact agreement: the
 *     EIP-3009 nonce on the direct path, the calldata hash on the GOAT path.
 *   - RELAYER_ROLE drives state transitions but never chooses a payee.
 *   - VERIFIER_ROLE only renders a verdict.
 *   - claimTimeoutRefund is permissionless AND works while paused, so a
 *     disappeared operator can never trap a creator's funds. That is the most
 *     important liveness property in this contract.
 *   - Neither agent needs ETH: funding is an EIP-3009 authorization signed by
 *     the creator and relayed here.
 */
contract A2AJobEscrow is AccessControl, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant RELAYER_ROLE  = keccak256("RELAYER_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant ARBITER_ROLE  = keccak256("ARBITER_ROLE");

    /// @notice Held by the GOAT Flow receiver contract, and nothing else. It
    /// can fund a job only with USDC it transfers in itself; it cannot move a
    /// job's state, render a verdict, or touch funds already in escrow.
    bytes32 public constant RECEIVER_ROLE = keccak256("RECEIVER_ROLE");

    enum JobStatus {
        NONE,
        POSTED,
        ESCROWED,
        EXECUTING,
        DELIVERED,
        SETTLED,
        REFUNDED,
        CANCELLED,
        DISPUTED
    }

    struct Job {
        uint256   creatorAgentId;    // ERC-8004 tokenId
        uint256   providerAgentId;   // 0 until funded
        address   creatorWallet;     // refund destination, set at postJob
        address   providerWallet;    // payout destination, fixed at funding
        bytes32   requirementsHash;  // keccak256 of the canonical requirements
        bytes32   agreementHash;     // EIP-712 agreement, set at funding
        bytes32   deliverableHash;   // set at delivery
        bytes32   reportHash;        // verifier's evaluation report
        uint128   budgetMin;         // USDC base units (6dp)
        uint128   budgetMax;
        uint128   agreedPrice;
        uint64    createdAt;
        uint64    fundedAt;
        uint64    executionDeadline;
        uint32    executionWindow;   // seconds; deadline computed at funding
        uint16    commissionBps;     // locked at funding
        JobStatus status;
    }

    IERC20  public immutable usdc;
    IAgentIdentityRegistry public immutable identityRegistry;
    address public treasury;

    /// @notice Commission on settlement, basis points. 1000 = 10%.
    uint16 public commissionBps = 1000;
    uint16 public constant MAX_COMMISSION_BPS = 2000;

    /// @notice Bounds on the execution window a job may specify.
    uint32 public constant MIN_EXECUTION_WINDOW = 5 minutes;
    uint32 public constant MAX_EXECUTION_WINDOW = 30 days;

    /// @notice Grace period after the execution deadline for the verifier to
    /// render a verdict before the creator may reclaim funds.
    uint64 public constant VERIFICATION_GRACE = 2 days;

    /// @notice How long the arbiter has to resolve a dispute before the creator
    /// may reclaim the escrow.
    uint64 public constant ARBITRATION_WINDOW = 14 days;

    mapping(bytes32 => Job) private _jobs;

    /// @notice When each job's dispute was raised. Zero for a job never disputed.
    mapping(bytes32 => uint64) public disputedAt;

    event JobPosted(
        bytes32 indexed jobId,
        uint256 indexed creatorAgentId,
        address indexed creatorWallet,
        bytes32 requirementsHash,
        uint128 budgetMin,
        uint128 budgetMax,
        uint32  executionWindow
    );
    event JobFunded(
        bytes32 indexed jobId,
        uint256 indexed providerAgentId,
        address indexed providerWallet,
        uint128 agreedPrice,
        bytes32 agreementHash,
        uint64  executionDeadline
    );
    event JobExecuting(bytes32 indexed jobId);

    /// @notice A job funded through the GOAT Flow receiver. JobFunded is also
    /// emitted, from _applyAgreement; this one records who paid and via what.
    event JobFundedByReceiver(bytes32 indexed jobId, address indexed payer, address indexed receiver);
    event DeliverableSubmitted(bytes32 indexed jobId, bytes32 deliverableHash);
    event JobSettled(bytes32 indexed jobId, address indexed providerWallet, uint128 payout, uint128 commission, bytes32 reportHash);
    event JobRefunded(bytes32 indexed jobId, address indexed creatorWallet, uint128 amount, string reason);
    event JobCancelled(bytes32 indexed jobId);
    event DisputeRaised(bytes32 indexed jobId, address indexed raisedBy);
    event DisputeResolved(bytes32 indexed jobId, uint128 toProvider, uint128 toCreator);
    event CommissionBpsUpdated(uint16 newBps);
    event TreasuryUpdated(address newTreasury);

    /**
     * @notice EIP-712 typehash for the negotiated agreement.
     *
     * @dev MUST stay byte-identical to AGREEMENT_TYPE_STRING in the
     *      protocol helpers (src/eip712.ts). If the
     *      two drift, every fundWithAuthorization reverts on a signature error
     *      that looks like a wallet fault and is not. The cross-check test in
     *      test/A2AJobEscrow.agreement.test.ts asserts the digest this contract
     *      computes equals the one ethers computes off-chain.
     */
    bytes32 public constant AGREEMENT_TYPEHASH = keccak256(
        "Agreement(bytes32 jobId,uint256 creatorAgentId,uint256 providerAgentId,"
        "address providerWallet,uint128 agreedPrice,bytes32 requirementsHash,"
        "uint32 executionWindow,bytes32 transcriptHash,uint64 expiry)"
    );

    /// @notice A creator-signed EIP-3009 authorization to move USDC into escrow.
    struct ReceiveAuthorization {
        address from;
        address to;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        uint8   v;
        bytes32 r;
        bytes32 s;
    }

    /// @notice The terms both agents sign. Mirrors the off-chain Agreement type.
    struct Agreement {
        bytes32 jobId;
        uint256 creatorAgentId;
        uint256 providerAgentId;
        address providerWallet;
        uint128 agreedPrice;
        bytes32 requirementsHash;
        uint32  executionWindow;
        bytes32 transcriptHash;
        uint64  expiry;
    }

    constructor(address admin, address usdcAddress, address treasuryAddress, address identityRegistryAddress)
        EIP712("KULT A2A Job Escrow", "1")
    {
        require(admin != address(0), "zero admin");
        require(usdcAddress != address(0), "zero usdc");
        require(treasuryAddress != address(0), "zero treasury");
        require(identityRegistryAddress != address(0), "zero identity registry");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        usdc = IERC20(usdcAddress);
        identityRegistry = IAgentIdentityRegistry(identityRegistryAddress);
        treasury = treasuryAddress;
    }

    // ── Posting ──────────────────────────────────────────────────────────────

    /**
     * @notice Register a job and commit its requirements hash.
     *
     * @dev `jobId` is derived off-chain as
     *      keccak256(abi.encode(creatorAgentId, requirementsHash, nonce)), so a
     *      retried post collides with the existing record and reverts here
     *      rather than creating a duplicate job.
     *
     *      No funds move. The creator's USDC is not touched until
     *      fundWithAuthorization, which is also where a provider is chosen —
     *      posting is free and non-committal.
     */
    function postJob(
        bytes32 jobId,
        uint256 creatorAgentId,
        address creatorWallet,
        bytes32 requirementsHash,
        uint128 budgetMin,
        uint128 budgetMax,
        uint32  executionWindow
    ) external onlyRole(RELAYER_ROLE) whenNotPaused {
        require(_jobs[jobId].status == JobStatus.NONE, "job exists");
        require(creatorAgentId != 0, "zero creator agent");
        require(creatorWallet != address(0), "zero creator wallet");
        require(requirementsHash != bytes32(0), "zero requirements hash");
        require(budgetMin > 0, "zero budget min");
        require(budgetMax >= budgetMin, "budget max < min");
        require(
            executionWindow >= MIN_EXECUTION_WINDOW && executionWindow <= MAX_EXECUTION_WINDOW,
            "bad execution window"
        );

        Job storage job = _jobs[jobId];
        job.creatorAgentId   = creatorAgentId;
        job.creatorWallet    = creatorWallet;
        job.requirementsHash = requirementsHash;
        job.budgetMin        = budgetMin;
        job.budgetMax        = budgetMax;
        job.executionWindow  = executionWindow;
        job.createdAt        = uint64(block.timestamp);
        job.status           = JobStatus.POSTED;

        emit JobPosted(
            jobId, creatorAgentId, creatorWallet, requirementsHash, budgetMin, budgetMax, executionWindow
        );
    }

    /// @notice Withdraw a job that was never funded. Only valid while POSTED.
    function cancelBeforeFunding(bytes32 jobId) external onlyRole(RELAYER_ROLE) {
        Job storage job = _jobs[jobId];
        require(job.status == JobStatus.POSTED, "not cancellable");
        job.status = JobStatus.CANCELLED;
        emit JobCancelled(jobId);
    }

    // ── Agreement verification ───────────────────────────────────────────────

    /**
     * @notice EIP-712 digest of an agreement — the value stored as
     *         Job.agreementHash and the thing both agents actually sign.
     */
    function hashAgreement(Agreement calldata agreement) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    AGREEMENT_TYPEHASH,
                    agreement.jobId,
                    agreement.creatorAgentId,
                    agreement.providerAgentId,
                    agreement.providerWallet,
                    agreement.agreedPrice,
                    agreement.requirementsHash,
                    agreement.executionWindow,
                    agreement.transcriptHash,
                    agreement.expiry
                )
            )
        );
    }

    /**
     * @notice Check that both agents signed these exact terms, each with the
     *         wallet bound to it in the ERC-8004 identity registry.
     *
     * @dev The signer addresses are supplied by the caller, so on their own
     *      they prove only that SOMEONE signed. Matching each against the
     *      registry is what makes the signature the named agent's. The payout
     *      address is a signed field, so it may differ from the provider's
     *      signing key: the bound key authorises it.
     *
     *      SignatureChecker accepts ECDSA and ERC-1271, so a Base Account (a
     *      smart-contract wallet) can be a counterparty with no separate code
     *      path. Exposed as a view so the relayer can fail fast off-chain
     *      rather than burning gas on a revert.
     */
    function verifyAgreement(
        Agreement calldata agreement,
        address creatorSigner,
        bytes calldata creatorSig,
        address providerSigner,
        bytes calldata providerSig
    ) public view returns (bool) {
        return _isAgentWallet(agreement.creatorAgentId, creatorSigner)
            && _isAgentWallet(agreement.providerAgentId, providerSigner)
            && _signaturesValid(hashAgreement(agreement), creatorSigner, creatorSig, providerSigner, providerSig);
    }

    /// @dev True only for the wallet bound to `agentId`. An agent with no bound
    ///      wallet can be party to no agreement.
    function _isAgentWallet(uint256 agentId, address signer) private view returns (bool) {
        address bound = identityRegistry.getAgentWallet(agentId);
        return bound != address(0) && bound == signer;
    }

    function _signaturesValid(
        bytes32 digest,
        address creatorSigner,
        bytes calldata creatorSig,
        address providerSigner,
        bytes calldata providerSig
    ) private view returns (bool) {
        return SignatureChecker.isValidSignatureNow(creatorSigner, digest, creatorSig)
            && SignatureChecker.isValidSignatureNow(providerSigner, digest, providerSig);
    }

    /// @notice Domain separator, exposed so off-chain signers can assert a match.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ── Funding ──────────────────────────────────────────────────────────────

    /**
     * @notice Commit the agreement and pull the creator's USDC, atomically.
     *
     * @dev This is the centrepiece of the contract. It does four things that
     *      must happen together or not at all:
     *
     *        1. verifies BOTH agents signed these exact terms,
     *        2. checks the agreed price sits inside the posted budget — the
     *           frontend cannot alter a number both parties signed,
     *        3. fixes the payout destination for the rest of the job,
     *        4. pulls USDC via EIP-3009 receiveWithAuthorization.
     *
     *      receiveWithAuthorization (not transferWithAuthorization) is
     *      deliberate: it requires msg.sender == to, so only this contract can
     *      submit the creator's signed authorization. transferWithAuthorization
     *      is frontrunnable — anyone observing the mempool could submit it and
     *      grief the flow.
     *
     *      Neither agent needs ETH on Base. The creator signs an authorization;
     *      the relayer pays gas. The relayer cannot alter the terms it relays:
     *      both agent signatures cover them, and the authorization's nonce
     *      must be the agreement hash, so the creator's USDC signature is
     *      spendable on exactly one agreement and no other.
     */
    function fundWithAuthorization(
        bytes32 jobId,
        Agreement calldata agreement,
        address creatorSigner,
        bytes calldata creatorSig,
        address providerSigner,
        bytes calldata providerSig,
        ReceiveAuthorization calldata auth
    ) external onlyRole(RELAYER_ROLE) whenNotPaused nonReentrant {
        Job storage job = _jobs[jobId];
        require(job.status == JobStatus.POSTED, "not fundable");

        // The authorization must pay THIS contract, exactly the agreed amount.
        // Anything else is either a mistake or an attempt to under-fund.
        require(auth.to == address(this), "authorization payee is not the escrow");
        require(auth.value == agreement.agreedPrice, "authorization value != agreed price");
        require(auth.from == job.creatorWallet, "authorization payer is not the creator");

        // Without this, an authorization the creator signed for one agreement
        // could be paired with any other agreement of the same price.
        bytes32 agreementHash = hashAgreement(agreement);
        require(auth.nonce == agreementHash, "authorization is not for this agreement");

        _applyAgreement(jobId, job, agreement, agreementHash, creatorSigner, creatorSig, providerSigner, providerSig);

        uint256 balanceBefore = usdc.balanceOf(address(this));

        IERC3009(address(usdc)).receiveWithAuthorization(
            auth.from, auth.to, auth.value,
            auth.validAfter, auth.validBefore, auth.nonce,
            auth.v, auth.r, auth.s
        );

        // A fee-on-transfer or otherwise non-standard token would leave the
        // escrow short and settlement would fail later, when the money is
        // already gone. Fail here instead.
        require(
            usdc.balanceOf(address(this)) - balanceBefore == agreement.agreedPrice,
            "escrow did not receive the full amount"
        );
    }

    /**
     * @notice Validate an agreement and move the job to ESCROWED.
     *
     * @dev Shared by both funding paths. Everything here is about the TERMS;
     *      how the USDC arrives is the caller's business. Splitting it this way
     *      means the receiver path cannot drift from the direct path on any of the
     *      checks that decide whether money moves.
     *
     *      Does not move tokens.
     */
    function _applyAgreement(
        bytes32 jobId,
        Job storage job,
        Agreement calldata agreement,
        bytes32 agreementHash,
        address creatorSigner,
        bytes calldata creatorSig,
        address providerSigner,
        bytes calldata providerSig
    ) private {
        // The agreement must describe THIS job, not another one.
        require(agreement.jobId == jobId, "agreement/job mismatch");
        require(agreement.creatorAgentId == job.creatorAgentId, "creator mismatch");
        require(agreement.requirementsHash == job.requirementsHash, "requirements mismatch");
        require(agreement.executionWindow == job.executionWindow, "window mismatch");
        require(agreement.providerAgentId != 0, "zero provider agent");
        require(agreement.providerWallet != address(0), "zero provider wallet");
        require(agreement.expiry > block.timestamp, "agreement expired");

        // Bounds enforced on-chain, independently of anything off-chain.
        require(
            agreement.agreedPrice >= job.budgetMin && agreement.agreedPrice <= job.budgetMax,
            "price outside budget"
        );

        // A provider cannot be its own client — that is self-dealing, and it
        // would let one owner manufacture reputation for free.
        require(agreement.providerWallet != job.creatorWallet, "self-dealing");

        // Checked apart from the signatures so a failure names its cause.
        require(_isAgentWallet(agreement.creatorAgentId, creatorSigner), "creator signer is not the agent wallet");
        require(_isAgentWallet(agreement.providerAgentId, providerSigner), "provider signer is not the agent wallet");
        require(
            _signaturesValid(agreementHash, creatorSigner, creatorSig, providerSigner, providerSig),
            "bad agreement signatures"
        );

        job.providerAgentId    = agreement.providerAgentId;
        job.providerWallet     = agreement.providerWallet;
        job.agreementHash      = agreementHash;
        job.agreedPrice        = agreement.agreedPrice;
        job.fundedAt           = uint64(block.timestamp);
        job.executionDeadline  = uint64(block.timestamp) + job.executionWindow;
        job.commissionBps      = commissionBps;   // locked for this job
        job.status             = JobStatus.ESCROWED;

        emit JobFunded(
            jobId, agreement.providerAgentId, agreement.providerWallet,
            agreement.agreedPrice, agreementHash, job.executionDeadline
        );
    }

    // ── Funding via the GOAT Flow receiver ───────────────────────────────────

    /**
     * @notice Fund a job with USDC the GOAT Flow receiver already holds.
     *
     * @dev The GOAT callback lives on KultGoatReceiver, not here. GOAT's design
     *      is that a failed calldata self-call never reverts the payment, and
     *      the receiver keeps any USDC it could not bind until it is refunded.
     *      That is correct for a receiver and wrong for an escrow, where
     *      unattributed buyer money would pool with every other job's locked
     *      funds. So the receiver takes the payment, and calls this only once it
     *      is ready to commit USDC to a specific job.
     *
     *      `payer` is the address the receiver cryptographically verified as
     *      the signer of the buyer's calldata. Matching it against
     *      creatorWallet here is the same identity check fundWithAuthorization
     *      makes against the EIP-3009 `from`. GOAT's TSS wallet is the token
     *      payer on that side, so the verified signer is the only place the
     *      buyer is provable.
     *
     *      Reverting is safe here, unlike in the callback. This is reached from
     *      inside the receiver's calldata self-call, so a revert rolls back only
     *      that self-call: the receiver keeps the USDC credited to the payer and
     *      GOAT's payment stands.
     */
    function fundFromReceiver(
        bytes32 jobId,
        address payer,
        Agreement calldata agreement,
        address creatorSigner,
        bytes calldata creatorSig,
        address providerSigner,
        bytes calldata providerSig
    ) external onlyRole(RECEIVER_ROLE) whenNotPaused nonReentrant {
        Job storage job = _jobs[jobId];
        require(job.status == JobStatus.POSTED, "not fundable");
        require(payer == job.creatorWallet, "payer is not the job creator");

        // No nonce check here: the payer's signature over the calldata hash,
        // verified by the receiver, already covers this exact agreement.
        _applyAgreement(
            jobId, job, agreement, hashAgreement(agreement), creatorSigner, creatorSig, providerSigner, providerSig
        );

        uint256 balanceBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), agreement.agreedPrice);
        require(
            usdc.balanceOf(address(this)) - balanceBefore == agreement.agreedPrice,
            "escrow did not receive the full amount"
        );

        emit JobFundedByReceiver(jobId, payer, msg.sender);
    }

    /// @notice Provider has begun work. Informational, but it timestamps the start.
    function markExecuting(bytes32 jobId) external onlyRole(RELAYER_ROLE) whenNotPaused {
        Job storage job = _jobs[jobId];
        require(job.status == JobStatus.ESCROWED, "not escrowed");
        job.status = JobStatus.EXECUTING;
        emit JobExecuting(jobId);
    }

    /**
     * @notice Commit the hash of the delivered artifact.
     *
     * @dev Allowed from ESCROWED as well as EXECUTING: markExecuting is a
     *      convenience, and a provider that finished before the relayer got
     *      around to flipping the flag should not be blocked from delivering.
     */
    function submitDeliverable(bytes32 jobId, bytes32 deliverableHash)
        external onlyRole(RELAYER_ROLE) whenNotPaused
    {
        Job storage job = _jobs[jobId];
        require(job.status == JobStatus.ESCROWED || job.status == JobStatus.EXECUTING, "not in progress");
        require(deliverableHash != bytes32(0), "zero deliverable hash");
        require(block.timestamp <= job.executionDeadline, "past execution deadline");

        job.deliverableHash = deliverableHash;
        job.status = JobStatus.DELIVERED;
        emit DeliverableSubmitted(jobId, deliverableHash);
    }

    // ── Settlement ───────────────────────────────────────────────────────────

    /**
     * @notice The verifier's verdict. Pays out or refunds in this same call.
     *
     * @dev VERIFIER_ROLE is a different key from RELAYER_ROLE by deployment
     *      policy: one drives a job's state, the other judges its outcome.
     *      The verifier still cannot choose a payee — the destination was
     *      fixed at funding from a signature both parties produced.
     */
    function submitVerdict(bytes32 jobId, bool accepted, bytes32 reportHash)
        external onlyRole(VERIFIER_ROLE) nonReentrant
    {
        Job storage job = _jobs[jobId];
        require(job.status == JobStatus.DELIVERED, "not delivered");
        require(reportHash != bytes32(0), "zero report hash");

        job.reportHash = reportHash;

        if (!accepted) {
            // Work was delivered but missed the target. The creator gets
            // everything back; no commission is taken on a failed job.
            uint128 amount = job.agreedPrice;
            job.status = JobStatus.REFUNDED;
            usdc.safeTransfer(job.creatorWallet, amount);
            emit JobRefunded(jobId, job.creatorWallet, amount, "verdict rejected");
            return;
        }

        uint128 commission = uint128((uint256(job.agreedPrice) * job.commissionBps) / 10_000);
        uint128 payout     = job.agreedPrice - commission;

        job.status = JobStatus.SETTLED;

        usdc.safeTransfer(job.providerWallet, payout);
        if (commission > 0) usdc.safeTransfer(treasury, commission);

        emit JobSettled(jobId, job.providerWallet, payout, commission, reportHash);
    }

    // ── Recovery ─────────────────────────────────────────────────────────────

    /**
     * @notice Reclaim escrowed funds after the deadline passes.
     *
     * @dev PERMISSIONLESS, and deliberately NOT gated on whenNotPaused. This
     *      is the most important liveness property in the contract: if the
     *      relayer disappears, the verifier or arbiter goes silent, or an admin pauses
     *      and never returns, the creator's USDC must still be recoverable.
     *      Anyone may call it; the money can only ever go to the creator.
     */
    function claimTimeoutRefund(bytes32 jobId) external nonReentrant {
        Job storage job = _jobs[jobId];
        require(_refundClaimable(jobId, job), "not refund-claimable");

        string memory reason = job.status == JobStatus.DISPUTED ? "arbitration timeout" : "timeout";
        uint128 amount = job.agreedPrice;
        address creator = job.creatorWallet;
        job.status = JobStatus.REFUNDED;

        usdc.safeTransfer(creator, amount);
        emit JobRefunded(jobId, creator, amount, reason);
    }

    /**
     * @notice Either party escalates before settlement.
     *
     * @dev Raising a dispute stops the timeout-refund clock, so a creator
     *      cannot dispute a delivered job and then quietly wait for the
     *      deadline to reclaim funds anyway.
     *
     *      Two limits keep that pause from becoming a trap:
     *
     *        1. A dispute must be raised while the refund clock is still
     *           running. Once the creator can reclaim, a dispute would only
     *           freeze a refund already owed.
     *        2. The arbiter has ARBITRATION_WINDOW to resolve it. After that
     *           the creator may reclaim, exactly as when the verifier goes
     *           silent. The arbiter can still resolve late, until someone
     *           claims the refund.
     */
    function raiseDispute(bytes32 jobId) external {
        Job storage job = _jobs[jobId];
        require(
            job.status == JobStatus.ESCROWED
                || job.status == JobStatus.EXECUTING
                || job.status == JobStatus.DELIVERED,
            "not disputable"
        );
        require(
            msg.sender == job.creatorWallet || msg.sender == job.providerWallet,
            "not a party to this job"
        );
        require(!_refundClaimable(jobId, job), "dispute window closed");

        job.status = JobStatus.DISPUTED;
        disputedAt[jobId] = uint64(block.timestamp);
        emit DisputeRaised(jobId, msg.sender);
    }

    /**
     * @notice Arbiter splits the escrow. Supports partial completion.
     *
     * @dev The split must account for the whole escrow exactly — no rounding
     *      slack that would strand dust, and no over-payment that would draw
     *      on another job's funds.
     */
    function resolveDispute(bytes32 jobId, uint128 toProvider, uint128 toCreator)
        external onlyRole(ARBITER_ROLE) nonReentrant
    {
        Job storage job = _jobs[jobId];
        require(job.status == JobStatus.DISPUTED, "not disputed");
        require(toProvider + toCreator == job.agreedPrice, "split must equal the escrowed amount");

        job.status = JobStatus.SETTLED;

        if (toProvider > 0) usdc.safeTransfer(job.providerWallet, toProvider);
        if (toCreator  > 0) usdc.safeTransfer(job.creatorWallet,  toCreator);

        emit DisputeResolved(jobId, toProvider, toCreator);
    }

    // ── Views ────────────────────────────────────────────────────────────────

    function getJob(bytes32 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }

    function jobStatus(bytes32 jobId) external view returns (JobStatus) {
        return _jobs[jobId].status;
    }

    function exists(bytes32 jobId) external view returns (bool) {
        return _jobs[jobId].status != JobStatus.NONE;
    }

    /**
     * @notice Whether a timeout refund may be claimed right now.
     * @dev Exposed so a client can show the creator an honest "your funds are
     *      reclaimable" state rather than making them guess.
     */
    function refundClaimable(bytes32 jobId) external view returns (bool) {
        return _refundClaimable(jobId, _jobs[jobId]);
    }

    function _refundClaimable(bytes32 jobId, Job storage job) private view returns (bool) {
        if (job.status == JobStatus.ESCROWED || job.status == JobStatus.EXECUTING) {
            return block.timestamp > job.executionDeadline;
        }
        // Delivered work still owed a verdict: the verifier gets a grace
        // period, after which the creator must not stay locked up.
        if (job.status == JobStatus.DELIVERED) {
            return block.timestamp > job.executionDeadline + VERIFICATION_GRACE;
        }
        // Same principle for an arbiter that never rules.
        if (job.status == JobStatus.DISPUTED) {
            return block.timestamp > disputedAt[jobId] + ARBITRATION_WINDOW;
        }
        return false;
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    function setCommissionBps(uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(bps <= MAX_COMMISSION_BPS, "commission too high");
        commissionBps = bps;
        emit CommissionBpsUpdated(bps);
    }

    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newTreasury != address(0), "zero treasury");
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    /**
     * @dev Pausing blocks new jobs and new funding. It deliberately does NOT
     *      block claimTimeoutRefund — an admin must never be able to trap
     *      escrowed funds by pausing.
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
}
