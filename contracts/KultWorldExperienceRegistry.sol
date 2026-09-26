// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title KULT World Experience Registry
/// @notice Portable, evidence-based Agent receipts for Robinhood Chain.
/// @dev The registry deliberately publishes facts and issuer provenance, never a universal reputation score.
contract KultWorldExperienceRegistry {
    struct ExperienceReceipt {
        bytes32 receiptId;
        bytes32 localAgentId;
        bytes32 agentKey;
        bytes32 evidenceHash;
        address issuer;
        uint64 recordedAt;
        uint16 difficulty;
        uint8 domain;
        uint8 outcome;
        bool verifiedIssuer;
    }

    address public owner;
    address public pendingOwner;
    mapping(address => bool) public authorizedIssuers;
    mapping(bytes32 => address) public agentOwner;
    mapping(bytes32 => bool) public usedReceiptKey;
    mapping(bytes32 => bytes32) public seasonManifestHash;
    mapping(bytes32 => ExperienceReceipt[]) private receiptsByAgent;

    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event IssuerAuthorizationChanged(address indexed issuer, bool authorized);
    event AgentRegistered(bytes32 indexed agentKey, bytes32 indexed localAgentId, address indexed owner);
    event ExperienceRecorded(
        bytes32 indexed receiptId,
        bytes32 indexed agentKey,
        address indexed issuer,
        bytes32 localAgentId,
        bytes32 evidenceHash,
        uint8 domain,
        uint8 outcome,
        uint16 difficulty,
        bool verifiedIssuer
    );
    event SeasonManifestCommitted(bytes32 indexed seasonId, bytes32 indexed manifestHash, address indexed committer);

    error Unauthorized();
    error InvalidInput();
    error ReceiptAlreadyUsed();
    error SeasonAlreadyCommitted();

    constructor() {
        owner = msg.sender;
        authorizedIssuers[msg.sender] = true;
        emit OwnershipTransferred(address(0), msg.sender);
        emit IssuerAuthorizationChanged(msg.sender, true);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0) || nextOwner == owner) revert InvalidInput();
        pendingOwner = nextOwner;
        emit OwnershipTransferStarted(owner, nextOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert Unauthorized();
        address previous = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        if (authorizedIssuers[previous]) {
            authorizedIssuers[previous] = false;
            emit IssuerAuthorizationChanged(previous, false);
        }
        if (!authorizedIssuers[msg.sender]) {
            authorizedIssuers[msg.sender] = true;
            emit IssuerAuthorizationChanged(msg.sender, true);
        }
        emit OwnershipTransferred(previous, msg.sender);
    }

    function setIssuer(address issuer, bool authorized) external onlyOwner {
        if (issuer == address(0)) revert InvalidInput();
        authorizedIssuers[issuer] = authorized;
        emit IssuerAuthorizationChanged(issuer, authorized);
    }

    /// @notice Commits immutable Season rules before Agent outcomes are produced.
    /// @dev The manifest defines scoring/evolution rules; it never preselects Agent outcomes.
    function commitSeasonManifest(bytes32 seasonId, bytes32 manifestHash) external onlyOwner {
        if (seasonId == bytes32(0) || manifestHash == bytes32(0)) revert InvalidInput();
        if (seasonManifestHash[seasonId] != bytes32(0)) revert SeasonAlreadyCommitted();
        seasonManifestHash[seasonId] = manifestHash;
        emit SeasonManifestCommitted(seasonId, manifestHash, msg.sender);
    }

    /// @notice Generates a wallet-bound key, preventing another wallet from squatting a local Agent ID.
    function agentKeyFor(address account, bytes32 localAgentId) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(account, localAgentId));
    }

    function registerAndAnchor(
        bytes32 localAgentId,
        bytes32 receiptId,
        bytes32 evidenceHash,
        uint8 domain,
        uint8 outcome,
        uint16 difficulty
    ) external returns (bytes32 agentKey) {
        return _registerAndAnchor(msg.sender, localAgentId, receiptId, evidenceHash, domain, outcome, difficulty);
    }

    function issueVerifiedExperience(
        bytes32 receiptId,
        bytes32 agentKey,
        bytes32 localAgentId,
        bytes32 evidenceHash,
        uint8 domain,
        uint8 outcome,
        uint16 difficulty
    ) external {
        if (!authorizedIssuers[msg.sender]) revert Unauthorized();
        address registeredOwner = agentOwner[agentKey];
        if (registeredOwner == address(0)) revert InvalidInput();
        if (agentKeyFor(registeredOwner, localAgentId) != agentKey) revert InvalidInput();
        _record(receiptId, localAgentId, agentKey, evidenceHash, domain, outcome, difficulty, true);
    }

    function _registerAndAnchor(
        address account,
        bytes32 localAgentId,
        bytes32 receiptId,
        bytes32 evidenceHash,
        uint8 domain,
        uint8 outcome,
        uint16 difficulty
    ) internal returns (bytes32 agentKey) {
        if (localAgentId == bytes32(0)) revert InvalidInput();
        agentKey = agentKeyFor(account, localAgentId);
        address registeredOwner = agentOwner[agentKey];
        if (registeredOwner == address(0)) {
            agentOwner[agentKey] = account;
            emit AgentRegistered(agentKey, localAgentId, account);
        } else if (registeredOwner != account) {
            revert Unauthorized();
        }
        _record(receiptId, localAgentId, agentKey, evidenceHash, domain, outcome, difficulty, false);
    }

    function _record(
        bytes32 receiptId,
        bytes32 localAgentId,
        bytes32 agentKey,
        bytes32 evidenceHash,
        uint8 domain,
        uint8 outcome,
        uint16 difficulty,
        bool verifiedIssuer
    ) internal {
        if (receiptId == bytes32(0) || evidenceHash == bytes32(0)) revert InvalidInput();
        if (domain < 1 || domain > 4 || outcome < 1 || outcome > 2 || difficulty > 100) revert InvalidInput();
        bytes32 receiptKey = keccak256(abi.encode(agentKey, receiptId));
        if (usedReceiptKey[receiptKey]) revert ReceiptAlreadyUsed();
        usedReceiptKey[receiptKey] = true;
        receiptsByAgent[agentKey].push(ExperienceReceipt({
            receiptId: receiptId,
            localAgentId: localAgentId,
            agentKey: agentKey,
            evidenceHash: evidenceHash,
            issuer: msg.sender,
            recordedAt: uint64(block.timestamp),
            difficulty: difficulty,
            domain: domain,
            outcome: outcome,
            verifiedIssuer: verifiedIssuer
        }));
        emit ExperienceRecorded(receiptId, agentKey, msg.sender, localAgentId, evidenceHash, domain, outcome, difficulty, verifiedIssuer);
    }

    function receiptCount(bytes32 agentKey) external view returns (uint256) {
        return receiptsByAgent[agentKey].length;
    }

    function receiptAt(bytes32 agentKey, uint256 index) external view returns (ExperienceReceipt memory) {
        return receiptsByAgent[agentKey][index];
    }

    /// @notice Compact browser protocol: 0x01 + localAgentId + receiptId + evidenceHash + packed metadata.
    /// Metadata low bytes: domain:uint8 | outcome:uint8 | difficulty:uint16.
    fallback(bytes calldata input) external returns (bytes memory) {
        if (input.length != 129) revert InvalidInput();
        uint8 operation;
        bytes32 localAgentId;
        bytes32 receiptId;
        bytes32 evidenceHash;
        uint256 metadata;
        assembly {
            operation := byte(0, calldataload(input.offset))
            localAgentId := calldataload(add(input.offset, 1))
            receiptId := calldataload(add(input.offset, 33))
            evidenceHash := calldataload(add(input.offset, 65))
            metadata := calldataload(add(input.offset, 97))
        }
        if (operation != 1) revert InvalidInput();
        uint8 domain = uint8(metadata >> 24);
        uint8 outcome = uint8(metadata >> 16);
        uint16 difficulty = uint16(metadata);
        bytes32 agentKey = _registerAndAnchor(msg.sender, localAgentId, receiptId, evidenceHash, domain, outcome, difficulty);
        return abi.encode(agentKey);
    }
}
