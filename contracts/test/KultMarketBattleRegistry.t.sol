// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {KultMarketBattleRegistry} from "../KultMarketBattleRegistry.sol";

contract KultMarketBattleRegistryTest {
    bytes32 private constant BATTLE = keccak256("battle_1");
    bytes32 private constant AGENT = keccak256("agent_aegis");
    bytes32 private constant TRADE = keccak256("trade_1");

    function payload(uint8 outcome, int32 returnBps) private pure returns (bytes memory) {
        uint256 packed = (uint256(outcome) << 32) | uint256(uint32(returnBps));
        return abi.encodePacked(bytes1(0x02), BATTLE, AGENT, TRADE, bytes32(packed));
    }

    function testCompactReceiptRecordsBattle() external {
        KultMarketBattleRegistry registry = new KultMarketBattleRegistry();
        (bool ok,) = address(registry).call(payload(1, 123));
        require(ok, "receipt failed");
        require(registry.recordedBattle(BATTLE), "battle not recorded");
    }

    function testNegativeReturnBpsIsAccepted() external {
        KultMarketBattleRegistry registry = new KultMarketBattleRegistry();
        (bool ok,) = address(registry).call(payload(2, -87));
        require(ok, "negative bps rejected");
    }

    function testDuplicateBattleIsRejected() external {
        KultMarketBattleRegistry registry = new KultMarketBattleRegistry();
        (bool first,) = address(registry).call(payload(1, 10));
        (bool second,) = address(registry).call(payload(1, 10));
        require(first, "first receipt failed");
        require(!second, "duplicate battle accepted");
    }

    function testInvalidOutcomeIsRejected() external {
        KultMarketBattleRegistry registry = new KultMarketBattleRegistry();
        (bool ok,) = address(registry).call(payload(4, 0));
        require(!ok, "invalid outcome accepted");
    }

    function testMalformedPayloadIsRejected() external {
        KultMarketBattleRegistry registry = new KultMarketBattleRegistry();
        (bool ok,) = address(registry).call(abi.encodePacked(bytes1(0x02), BATTLE));
        require(!ok, "malformed payload accepted");
    }
}
