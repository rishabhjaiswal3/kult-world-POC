// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IX402Callback
 * @notice The callback goatx402 invokes on a merchant contract when a
 *         cross-chain payment settles on the destination chain.
 *
 * Vendored from GOATNetwork/x402 (goatx402-contract/src/IX402Callback.sol) and
 * reduced to the one method we implement. Declaring the whole interface would
 * force us to implement Permit2 and no-calldata variants we do not support,
 * and a stub that silently accepts a payment it cannot bind to a job is worse
 * than not implementing the method at all.
 *
 * The payment model, which is what matters here:
 *
 *   - `owner` is GOAT's TSS wallet and is the EIP-3009 payer. It is NOT the
 *     buyer. The tokens are already on Base, held by GOAT, and the TSS wallet
 *     signs an authorization letting the merchant contract pull them.
 *   - `originalPayer` is the account that created the order on the source
 *     chain, and it signs the calldata. This is the only link back to the real
 *     buyer, which is why the WithCalldata variant is the only one we can use:
 *     without it we would be accepting money from GOAT with no proof of who it
 *     came from.
 *   - The implementation is responsible for calling receiveWithAuthorization
 *     itself. goatx402 does not move the tokens; it hands over a signed
 *     authorization and expects the merchant to pull.
 */
interface IX402Callback {
    /**
     * @param token             EIP-3009 token being paid (must be our USDC)
     * @param originalPayer     buyer who created the order and signed calldata_
     * @param owner             GOAT TSS wallet holding the tokens
     * @param amount            amount authorized
     * @param validAfter        authorization not valid before this timestamp
     * @param validBefore       authorization not valid after this timestamp
     * @param nonce             EIP-3009 authorization nonce, single use in USDC
     * @param v                 EIP-3009 signature, recovery id
     * @param r                 EIP-3009 signature, r
     * @param s                 EIP-3009 signature, s
     * @param calldata_         buyer-signed call to execute after the pull
     * @param orderId           goatx402 order, binds the calldata to one order
     * @param calldataNonce     replay protection for calldata_, per payer
     * @param calldataDeadline  expiry of the calldata signature
     * @param calldataV         calldata signature, recovery id
     * @param calldataR         calldata signature, r
     * @param calldataS         calldata signature, s
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
    ) external;
}
