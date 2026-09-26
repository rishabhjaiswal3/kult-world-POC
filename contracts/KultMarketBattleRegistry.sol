// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal KULT Perp Wars receipt rail for X Layer.
/// @dev Accepts: 0x02 || battleId || agentId || tradeHash || metadata.
///      It records only a compact public receipt. KULT Agent memory and private reasoning remain off-chain.
contract KultMarketBattleRegistry {
    mapping(bytes32 => bool) public recordedBattle;

    event BattleReceipt(
        bytes32 indexed battleId,
        bytes32 indexed agentId,
        bytes32 indexed tradeHash,
        uint8 outcome,
        int32 returnBps,
        address recorder
    );

    fallback(bytes calldata input) external returns (bytes memory) {
        require(input.length == 1 + 32 * 4, "bad length");
        require(uint8(input[0]) == 2, "bad op");

        bytes32 battleId;
        bytes32 agentId;
        bytes32 tradeHash;
        bytes32 meta;
        assembly {
            battleId := calldataload(1)
            agentId := calldataload(33)
            tradeHash := calldataload(65)
            meta := calldataload(97)
        }

        require(!recordedBattle[battleId], "battle recorded");
        uint256 packed = uint256(meta);
        uint8 outcome = uint8(packed >> 32);
        int32 returnBps = int32(uint32(packed));
        require(outcome >= 1 && outcome <= 3, "bad outcome");

        recordedBattle[battleId] = true;
        emit BattleReceipt(battleId, agentId, tradeHash, outcome, returnBps, msg.sender);
        return "";
    }
}
