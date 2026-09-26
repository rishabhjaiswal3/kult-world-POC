# Integration guide

Deploying the contracts and connecting them to GOAT Flow. Steps are marked with
who performs them.

## Prerequisites

| Requirement | Owner |
| --- | --- |
| DELEGATE enabled for the merchant on Base mainnet | GOAT |
| GOAT Flow operator caller address for Base mainnet (a GOAT address) | GOAT |
| Merchant API key and secret | Merchant, from the GOAT Flow merchant portal |
| Funded merchant Fee Balance | Merchant, from the GOAT Flow merchant portal |
| Deployer account with ETH on Base | Merchant |
| Each agent registered in the ERC-8004 identity registry with its signing wallet bound (`setAgentWallet`) | Merchant |

GOAT charges service fees from the prepaid Fee Balance, not from payments, so the
receiver receives the full order amount. Orders fail if the Fee Balance is empty.

### DIRECT and DELEGATE

A merchant account is created in **DIRECT** mode, and the portal shows this as a
fixed *Receive type*. In DIRECT the buyer sends a plain ERC-20 transfer to a
receiving address configured in the portal.

This integration needs **DELEGATE**, in which GOAT settles the payment by calling
`x402SpentEip3009WithCalldata` on the merchant's receiver. DELEGATE is provisioned
by GOAT's deployment operator; an approved merchant account is not DELEGATE by
default.

Check the current mode without credentials:

```bash
curl https://flow-api.goat.network/merchants/<merchant-id>
```

The response includes `receive_type`, either `DIRECT` or `DELEGATE`.

## 1. Deploy the escrow

**Merchant.**

```bash
export BASE_RPC_URL=...
export DEPLOYER_PRIVATE_KEY=...
export BASE_RELAYER_ADDRESS=...     # drives job state
export A2A_VERIFIER_ADDRESS=...     # renders verdicts; must differ from the relayer
export A2A_ARBITER_ADDRESS=...      # resolves disputes (optional)
export A2A_TREASURY_ADDRESS=...     # receives commission

npm run deploy:escrow
```

Record the address as `A2A_JOB_ESCROW_ADDRESS`. The deployer keeps
`DEFAULT_ADMIN_ROLE`, which step 2 requires.

The escrow is deployed against the ERC-8004 identity registry on Base,
`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`, and accepts an agreement only when
each signature comes from the wallet bound to the named agent there. The
reference registry clears that binding when an agent NFT is transferred, so an
agent must be bound again after a transfer before it can sign.

## 2. Deploy the receiver

**Merchant.**

```bash
export A2A_JOB_ESCROW_ADDRESS=...
export GOAT_OPERATOR_ADDRESS=...    # from GOAT

npm run deploy:receiver
```

The script:

1. deploys `KultGoatReceiver`, wired to the escrow and to USDC on Base;
2. grants the receiver `RECEIVER_ROLE` on the escrow;
3. authorizes GOAT's operator on the receiver;
4. verifies all three, and that the receiver's EIP-712 domain matches GOAT's
   reference.

Each step is checked before it is sent. If the run is interrupted after the
deployment, set `GOAT_RECEIVER_ADDRESS` to the deployed address and run it again;
it resumes without deploying a second receiver.

## 3. Register the receiver with GOAT

**Merchant and GOAT.** Send GOAT's deployment operator the registration described
in GOAT's
[quick start, section 5](https://github.com/GOATNetwork/x402/blob/main/goatx402-contract/QUICK_START.md#5-register-with-the-deployment-operator):

- merchant identifier;
- callback chain ID: `8453`;
- the `KultGoatReceiver` address from step 2;
- the operator caller address authorized in step 2.

The callback is unusable until both sides are in place: the receiver has
authorized the operator on-chain, and GOAT has approved the receiver address and
ABI for the merchant. This address is also the `verifyingContract` of the calldata
signing domain.

> **Do not enter the receiver in the portal's Receiving Tokens & Addresses page.**
> That page configures DIRECT mode, where buyers send plain ERC-20 transfers to
> the address. Neither `KultGoatReceiver` nor `A2AJobEscrow` accepts a plain
> transfer: USDC sent to either that way is not credited and cannot be
> recovered. The receiver is registered only through the operator step above.

## 4. Configure the backend

**Merchant.**

| Variable | Value |
| --- | --- |
| `GOATX402_API_KEY` | Merchant API key |
| `GOATX402_API_SECRET` | Merchant API secret |
| `GOATX402_API_URL` | `https://flow-api.goat.network` |
| `GOAT_RECEIVER_ADDRESS` | Address from step 2 |

The order's `calldata_sign_request` includes `EIP712Domain` in `types`, and the
backend checks it against the receiver's domain before returning it. Pass the
request unchanged to `eth_signTypedData_v4`. With ethers' `signTypedData`, remove
`EIP712Domain` from `types` first, as GOAT's browser SDK does; ethers derives the
domain type from the domain object.

## 5. Verify end to end

**Merchant and GOAT.** Run one payment with real USDC on Base and confirm:

- `Eip3009CallbackWithCalldataReceived` and `PayerCredited` are emitted by the
  receiver;
- `CalldataExecuted` reports `success: true`;
- `JobFundedFromCredit` is emitted by the receiver, and `JobFunded` and
  `JobFundedByReceiver` by the escrow;
- `credit(payer)` on the receiver is zero, since the full amount went to the job.

## Operations

### Monitoring

Watch `CalldataExecuted` on the receiver. `success: false` means a payment was
received but not bound to a job, and the USDC is held as the payer's credit.

`result` is encoded one of two ways.

**Not executed.** The receiver refused to run the calldata. `result` is the reason
as raw UTF-8 bytes.

| `result` | Meaning |
| --- | --- |
| `calldata too short` | Calldata is under four bytes. |
| `selector not allowed` | Calldata targets a function other than `fundJob`. |

**Executed and reverted.** `result` is the revert data from `fundJob` or the
escrow: ABI-encoded `Error(string)` for the reasons below, or a custom error.

| Reason | Meaning |
| --- | --- |
| `insufficient credit` | Payment was less than the agreed price. |
| `not fundable` | Job not posted on-chain, or already funded. |
| `payer is not the job creator` | Signer is not the job creator's wallet. |
| `agreement expired` | The signed agreement expired before settlement. |
| `price outside budget` | Agreed price is outside the job's posted budget. |
| `creator signer is not the agent wallet` | Creator signer is not the wallet bound to the creator agent in the identity registry. |
| `provider signer is not the agent wallet` | Provider signer is not the wallet bound to the provider agent in the identity registry. |
| `bad agreement signatures` | Agent signatures on the agreement do not verify. |
| `self-dealing` | Provider wallet is the job creator's wallet. |
| `agreement/job mismatch`, `creator mismatch`, `requirements mismatch`, `window mismatch` | Agreement does not describe this job. |
| `zero provider agent`, `zero provider wallet` | Agreement is incomplete. |
| `EnforcedPause()` | Escrow is paused. |
| `AccessControlUnauthorizedAccount(address,bytes32)` | Receiver does not hold `RECEIVER_ROLE`. |

### Returning unbound credit

A payer can withdraw their own credit by calling `withdrawCredit()`. For a payer
without ETH for gas, an admin can call `refundCredit(payer)`, which sends the
credit only to that payer.

### Changing the signing domain

If GOAT changes the calldata signing domain, update the receiver with
`setDomain(name, version)` in coordination with GOAT. Signatures made under the
previous domain stop verifying once it changes.

### Revoking the operator

`setAuthorizedCaller(operator, false)` stops the receiver accepting callbacks from
that address. Credit already held remains withdrawable.

## Security properties

| Property | Enforced by |
| --- | --- |
| Only GOAT's operator can deliver a payment | `authorizedCallers` |
| A payment is attributed to the payer who signed for it | EIP-712 signature over `Eip3009CallbackData` |
| Signed calldata cannot be replayed | Per-payer calldata nonce and deadline |
| Signed calldata cannot be altered | `calldataHash` in the signed struct |
| Credit equals what was received | Balance increase check on the USDC pull |
| Calldata cannot call arbitrary functions | Single-selector allowlist |
| One payer's calldata cannot spend another's credit | `fundJob` debits only the verified payer |
| Unbound funds are never pooled with escrowed jobs | Separate receiver contract |
| Escrow funds cannot be withdrawn by the receiver | `RECEIVER_ROLE` permits funding only |
| Only the job creator can fund a job | Escrow checks payer against `creatorWallet` |
| Terms cannot be changed after signing | Escrow verifies both agents' signatures on the agreement |
| Agreement signers are the named agents, not addresses the caller supplies | Escrow checks each signer against `getAgentWallet` in the ERC-8004 identity registry |
| The creator's payment signature covers the exact agreement | GOAT path: `calldataHash`. Direct path: the EIP-3009 nonce must equal the agreement hash |
| A dispute cannot freeze a refund the creator is already owed | `raiseDispute` closes once a timeout refund is claimable |
| An unresolved dispute cannot lock funds indefinitely | Creator may reclaim after `ARBITRATION_WINDOW` (14 days) |

### Known limitations

- If the arbiter does not rule within `ARBITRATION_WINDOW`, the escrow returns to
  the creator, including for delivered work the creator disputed. Arbiter
  availability is an operational commitment. The arbiter may still rule after the
  window, until a refund is claimed.
- The admin can change the authorized operator and the signing domain, but cannot
  move credit anywhere other than back to its payer.
- The receiver is not upgradeable. A fix requires a new deployment and GOAT
  re-registering the new address.
- ERC-1271 contract-wallet signatures are not supported for the calldata
  signature, matching GOAT's reference.
