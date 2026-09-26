// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MockIdentityRegistry
 *
 * @notice Test-only stand-in for the ERC-8004 identity registry, reduced to the
 *         agent wallet binding the escrow reads.
 *
 * @dev The real registry binds a wallet only with that wallet's signature and
 *      clears it when the agent NFT is transferred. Those rules protect the
 *      registry, not the escrow: the escrow's only question is which address
 *      is bound, so tests set it directly.
 */
contract MockIdentityRegistry {
    mapping(uint256 => address) private _agentWallets;

    function bindAgentWallet(uint256 agentId, address wallet) external {
        _agentWallets[agentId] = wallet;
    }

    function getAgentWallet(uint256 agentId) external view returns (address) {
        return _agentWallets[agentId];
    }
}
