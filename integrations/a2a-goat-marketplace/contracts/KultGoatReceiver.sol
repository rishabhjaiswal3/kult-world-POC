// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import "./IX402Callback.sol";
import "./A2AJobEscrow.sol";

interface IERC3009Receive {
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
 * @title KultGoatReceiver
 * @notice Receives GOAT Flow DELEGATE payments on Base and funds A2A jobs with them.
 *
 * Built to GOAT's own callback specification
 * (GOATNetwork/x402, goatx402-contract/MERCHANT_CALLBACK.md). Three properties of
 * that spec decide the shape of this contract.
 *
 * 1. THE CALLBACK MUST NOT FAIL ON A BUSINESS CONDITION.
 *    GOAT retries a reverted callback, and the funds tied up are not released.
 *    Reverting because an agreement expired or a job was already funded would
 *    not protect the buyer; it would strand their money inside GOAT. So the
 *    reverts here are confined to the same category GOAT's reference reverts
 *    on — an unauthorized caller, a replayed or expired calldata signature, a
 *    signature that does not recover to the payer — plus two checks that the
 *    payment itself arrived as claimed. Everything to do with the job happens
 *    in a self-call whose failure is recorded, never propagated.
 *
 * 2. THE RECEIVER HOLDS WHAT IT COULD NOT BIND.
 *    "The contract holds tokens received through this callback flow until the
 *    owner withdraws them." That is why this is a separate contract rather than
 *    a method on the escrow: an unbound payment must never sit in the same
 *    balance as other jobs' locked funds. Here it is credited to the payer who
 *    signed for it, and the payer can reclaim it. There is deliberately no
 *    owner function that sends tokens to an arbitrary address — GOAT's
 *    reference has one, and its own security notes flag owner compromise.
 *
 * 3. THE CALLBACK MUST ENFORCE ITS OWN SELECTOR POLICY.
 *    GOAT's API reference: "bind-time calldata is buyer-controlled, may be
 *    omitted or replaced, and is not revalidated against the template. The
 *    callback contract must enforce its own selector, parameter, and
 *    permission policy." The reference implementation has no allowlist. This
 *    one allows exactly one selector through the self-call, fundJob, and
 *    fundJob can only spend the credit of the payer whose signature was just
 *    verified.
 */
contract KultGoatReceiver is IX402Callback, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    IERC20 public immutable usdc;
    A2AJobEscrow public immutable escrow;

    /// @notice GOAT Flow operator addresses permitted to deliver callbacks.
    mapping(address => bool) public authorizedCallers;

    /// @notice Replay protection for payer-signed calldata, as in GOAT's reference.
    mapping(address => mapping(uint256 => bool)) public calldataNonceUsed;

    /**
     * @notice USDC received for a payer and not yet committed to a job.
     * @dev The receiver's USDC balance is always at least the sum of all
     *      credit: credit rises only by an amount this contract verified it
     *      received, and falls only when that USDC leaves.
     */
    mapping(address => uint256) public credit;

    /**
     * @notice EIP-712 domain the payer signs the calldata under.
     * @dev Defaults to GOAT's reference values. Settable because GOAT's SDK and
     *      operator own them: their spec upgrades the domain through a
     *      coordinated reinitialize, and a change here must stay in step.
     */
    string public domainName = "GoatX402 Pay Callback";
    string public domainVersion = "1";

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /// @dev Must match GOAT's struct byte for byte or the payer's signature will not recover.
    bytes32 public constant EIP3009_CALLBACK_DATA_TYPEHASH = keccak256(
        "Eip3009CallbackData(address token,address owner,address payer,uint256 amount,bytes32 orderId,uint256 calldataNonce,uint256 deadline,bytes32 calldataHash)"
    );

    /// @dev The one selector the payer's calldata may reach.
    bytes4 public constant FUND_JOB_SELECTOR = this.fundJob.selector;

    /**
     * @dev The payer whose signature the in-flight callback verified. Set
     *      immediately before the self-call and cleared after, so fundJob can
     *      only ever spend that payer's credit, whatever the calldata says.
     */
    address private _currentPayer;

    // ── Events ───────────────────────────────────────────────────────────────

    /// @notice Same signature as GOAT's reference, so their tooling reads it.
    event Eip3009CallbackWithCalldataReceived(
        address indexed token,
        address indexed originalPayer,
        address indexed owner,
        uint256 amount,
        bytes32 nonce,
        bytes calldata_,
        uint256 calldataNonce
    );

    /// @notice Same signature as GOAT's reference. `success` false is a business failure, not a lost payment.
    event CalldataExecuted(bytes calldata_, bool success, bytes result);

    event PayerCredited(address indexed payer, bytes32 indexed orderId, uint256 amount, uint256 creditAfter);
    event JobFundedFromCredit(bytes32 indexed jobId, address indexed payer, uint256 amount);
    event CreditWithdrawn(address indexed payer, uint256 amount);
    event AuthorizedCallerUpdated(address indexed caller, bool authorized);
    event DomainUpdated(string name, string version);

    constructor(address admin, address usdcAddress, address escrowAddress) {
        require(admin != address(0), "zero admin");
        require(usdcAddress != address(0), "zero usdc");
        require(escrowAddress != address(0), "zero escrow");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        usdc = IERC20(usdcAddress);
        escrow = A2AJobEscrow(escrowAddress);
    }

    // ── GOAT callback ────────────────────────────────────────────────────────

    /**
     * @notice Called by GOAT Flow's operator once a DELEGATE payment settles on Base.
     *
     * @dev Order of operations follows GOAT's documented sequence: nonce,
     *      deadline, signature, mark nonce, pull, then self-call. The credit is
     *      written between the pull and the self-call, which is what makes a
     *      failed self-call safe: the self-call's own state rolls back, the
     *      credit does not.
     */
    function x402SpentEip3009WithCalldata(
        address token,
        address originalPayer,
        address owner,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s,
        bytes calldata calldata_,
        bytes32 orderId,
        uint256 calldataNonce,
        uint256 calldataDeadline,
        uint8 calldataV,
        bytes32 calldataR,
        bytes32 calldataS
    ) external override nonReentrant {
        require(authorizedCallers[msg.sender], "unauthorized caller");
        require(!calldataNonceUsed[originalPayer][calldataNonce], "calldata nonce used");
        require(block.timestamp <= calldataDeadline, "calldata signature expired");

        // Pinned rather than trusted from the argument. GOAT's reference keeps
        // no token allowlist; this contract credits USDC and nothing else, and
        // crediting an arbitrary token as USDC would be a real theft path.
        require(token == address(usdc), "unexpected token");

        _verifyPayerSignature(
            token, owner, originalPayer, amount, orderId, calldataNonce, calldataDeadline,
            calldata_, calldataV, calldataR, calldataS
        );

        calldataNonceUsed[originalPayer][calldataNonce] = true;

        // Exact balance delta, as GOAT's own TopupCallback checks. Their spec
        // notes MerchantCallback does not, and that the emitted amount can then
        // differ from what arrived. Credit must equal what actually arrived.
        uint256 balanceBefore = usdc.balanceOf(address(this));
        IERC3009Receive(token).receiveWithAuthorization(
            owner, address(this), amount, validAfter, validBefore, nonce, v, r, s
        );
        uint256 received = usdc.balanceOf(address(this)) - balanceBefore;
        require(received == amount, "received amount mismatch");

        credit[originalPayer] += received;
        emit PayerCredited(originalPayer, orderId, received, credit[originalPayer]);
        emit Eip3009CallbackWithCalldataReceived(token, originalPayer, owner, amount, nonce, calldata_, calldataNonce);

        _executeCalldata(originalPayer, calldata_);
    }

    // ── The one function calldata may reach ─────────────────────────────────

    /**
     * @notice Commit the verified payer's credit to one job.
     *
     * @dev Only reachable through the callback's self-call. It spends the
     *      credit of `_currentPayer`, never an address from the calldata, so
     *      signed bytes cannot redirect someone else's balance.
     *
     *      Free to revert. It runs inside the self-call, so a revert undoes the
     *      credit debit and the approval together, leaves the USDC credited to
     *      the payer, and does not touch GOAT's completed payment. Every
     *      business check the escrow makes — expired agreement, price outside
     *      budget, job already funded, payer not the creator — is enforced by
     *      the escrow and simply leaves the credit where it was.
     *
     *      Not nonReentrant: the callback holds the guard for the whole call,
     *      and msg.sender == address(this) is only possible from inside it.
     */
    function fundJob(
        bytes32 jobId,
        A2AJobEscrow.Agreement calldata agreement,
        address creatorSigner,
        bytes calldata creatorSig,
        address providerSigner,
        bytes calldata providerSig
    ) external {
        require(msg.sender == address(this), "self only");

        address payer = _currentPayer;
        require(payer != address(0), "no payer in context");

        uint256 price = agreement.agreedPrice;
        require(credit[payer] >= price, "insufficient credit");

        credit[payer] -= price;
        usdc.forceApprove(address(escrow), price);

        escrow.fundFromReceiver(jobId, payer, agreement, creatorSigner, creatorSig, providerSigner, providerSig);

        emit JobFundedFromCredit(jobId, payer, price);
    }

    // ── Reclaiming unbound credit ────────────────────────────────────────────

    /**
     * @notice Withdraw your own unbound credit to your own address.
     * @dev The payer signed the calldata, so the payer is an EOA on Base and can
     *      call this directly. A payment whose job could not be funded is never
     *      lost: it waits here for the person it belongs to.
     */
    function withdrawCredit() external nonReentrant {
        uint256 amount = credit[msg.sender];
        require(amount > 0, "no credit");
        credit[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);
        emit CreditWithdrawn(msg.sender, amount);
    }

    /**
     * @notice Return a payer's unbound credit to that payer, on their behalf.
     * @dev For buyers who hold no ETH for gas. The destination is fixed to the
     *      credited payer: an admin can return money to its owner but cannot
     *      send it anywhere else, which is the difference from GOAT's reference
     *      `withdrawTokens(token, to, amount)`.
     */
    function refundCredit(address payer) external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 amount = credit[payer];
        require(amount > 0, "no credit");
        credit[payer] = 0;
        usdc.safeTransfer(payer, amount);
        emit CreditWithdrawn(payer, amount);
    }

    // ── Administration ───────────────────────────────────────────────────────

    function setAuthorizedCaller(address caller, bool authorized) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(caller != address(0), "zero caller");
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerUpdated(caller, authorized);
    }

    function setDomain(string calldata name_, string calldata version_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        domainName = name_;
        domainVersion = version_;
        emit DomainUpdated(name_, version_);
    }

    // ── Views ────────────────────────────────────────────────────────────────

    /// @notice The domain separator GOAT's `calldata_sign_request` must carry for this contract.
    function getDomainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes(domainName)),
                keccak256(bytes(domainVersion)),
                block.chainid,
                address(this)
            )
        );
    }

    // ── Internals ────────────────────────────────────────────────────────────

    function _verifyPayerSignature(
        address token,
        address owner,
        address payer,
        uint256 amount,
        bytes32 orderId,
        uint256 calldataNonce,
        uint256 deadline,
        bytes calldata calldata_,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) private view {
        bytes32 structHash = keccak256(
            abi.encode(
                EIP3009_CALLBACK_DATA_TYPEHASH,
                token, owner, payer, amount, orderId, calldataNonce, deadline, keccak256(calldata_)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", getDomainSeparator(), structHash));
        require(digest.recover(v, r, s) == payer, "invalid calldata signature");
    }

    /**
     * @dev GOAT's semantics, deliberately: the self-call's failure is emitted,
     *      not propagated. Two additions. Only fundJob is reachable, and a
     *      disallowed selector is recorded as a failed execution rather than
     *      reverting, because the payment is valid even when the calldata is
     *      not. And the verified payer is placed in context for fundJob.
     */
    function _executeCalldata(address payer, bytes calldata calldata_) private {
        if (calldata_.length < 4) {
            emit CalldataExecuted(calldata_, false, bytes("calldata too short"));
            return;
        }
        if (bytes4(calldata_[:4]) != FUND_JOB_SELECTOR) {
            emit CalldataExecuted(calldata_, false, bytes("selector not allowed"));
            return;
        }

        _currentPayer = payer;
        (bool success, bytes memory result) = address(this).call(calldata_);
        _currentPayer = address(0);

        emit CalldataExecuted(calldata_, success, result);
    }
}
