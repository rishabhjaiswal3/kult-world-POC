// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {KultWorldExperienceRegistry} from "../KultWorldExperienceRegistry.sol";

contract RegistryActor {
    function anchor(
        KultWorldExperienceRegistry registry,
        bytes32 localAgentId,
        bytes32 receiptId,
        bytes32 evidenceHash
    ) external returns (bytes32) {
        return registry.registerAndAnchor(localAgentId, receiptId, evidenceHash, 1, 1, 42);
    }

    function acceptOwnership(KultWorldExperienceRegistry registry) external {
        registry.acceptOwnership();
    }
}

contract KultWorldExperienceRegistryTest {
    bytes32 private constant AGENT = keccak256("agent_nori");
    bytes32 private constant RECEIPT = keccak256("receipt_1");
    bytes32 private constant EVIDENCE = keccak256("evidence_1");
    bytes32 private constant SEASON = keccak256("season_01");
    bytes32 private constant MANIFEST = keccak256("manifest_01");

    function testSeasonManifestIsImmutableAfterCommit() external {
        KultWorldExperienceRegistry registry = new KultWorldExperienceRegistry();
        registry.commitSeasonManifest(SEASON, MANIFEST);
        require(registry.seasonManifestHash(SEASON) == MANIFEST, "manifest mismatch");

        bool reverted;
        try registry.commitSeasonManifest(SEASON, keccak256("changed")) {} catch { reverted = true; }
        require(reverted, "season commitment must be immutable");
    }

    function testWalletBoundAgentKeysPreventSquatting() external {
        KultWorldExperienceRegistry registry = new KultWorldExperienceRegistry();
        RegistryActor first = new RegistryActor();
        RegistryActor second = new RegistryActor();

        bytes32 firstKey = first.anchor(registry, AGENT, RECEIPT, EVIDENCE);
        bytes32 secondKey = second.anchor(registry, AGENT, RECEIPT, EVIDENCE);

        require(firstKey != secondKey, "keys must be wallet bound");
        require(registry.agentOwner(firstKey) == address(first), "first owner mismatch");
        require(registry.agentOwner(secondKey) == address(second), "second owner mismatch");
    }

    function testReceiptReplayIsScopedAndRejectedPerAgent() external {
        KultWorldExperienceRegistry registry = new KultWorldExperienceRegistry();
        RegistryActor first = new RegistryActor();
        RegistryActor second = new RegistryActor();
        first.anchor(registry, AGENT, RECEIPT, EVIDENCE);
        second.anchor(registry, AGENT, RECEIPT, EVIDENCE);

        bool reverted;
        try first.anchor(registry, AGENT, RECEIPT, EVIDENCE) {} catch { reverted = true; }
        require(reverted, "same Agent receipt replay must revert");
    }

    function testCompactFallbackRecordsStructuredReceipt() external {
        KultWorldExperienceRegistry registry = new KultWorldExperienceRegistry();
        uint256 metadata = (uint256(1) << 24) | (uint256(2) << 16) | uint256(61);
        bytes memory payload = abi.encodePacked(bytes1(0x01), AGENT, RECEIPT, EVIDENCE, bytes32(metadata));
        (bool ok, bytes memory returned) = address(registry).call(payload);

        require(ok, "compact anchor failed");
        bytes32 agentKey = abi.decode(returned, (bytes32));
        require(registry.receiptCount(agentKey) == 1, "receipt not recorded");
        KultWorldExperienceRegistry.ExperienceReceipt memory receipt = registry.receiptAt(agentKey, 0);
        require(receipt.localAgentId == AGENT, "agent mismatch");
        require(receipt.domain == 1 && receipt.outcome == 2, "metadata mismatch");
        require(receipt.difficulty == 61, "difficulty mismatch");
        require(!receipt.verifiedIssuer, "self receipt mislabeled");
    }

    function testOwnershipTransferRotatesIssuerAuthority() external {
        KultWorldExperienceRegistry registry = new KultWorldExperienceRegistry();
        RegistryActor nextOwner = new RegistryActor();
        registry.transferOwnership(address(nextOwner));
        nextOwner.acceptOwnership(registry);

        require(registry.owner() == address(nextOwner), "owner not transferred");
        require(!registry.authorizedIssuers(address(this)), "old owner still issuer");
        require(registry.authorizedIssuers(address(nextOwner)), "new owner not issuer");
    }

    function testRejectsMalformedCompactPayload() external {
        KultWorldExperienceRegistry registry = new KultWorldExperienceRegistry();
        (bool ok,) = address(registry).call(abi.encodePacked(bytes1(0x01), AGENT));
        require(!ok, "malformed payload accepted");
    }
}
