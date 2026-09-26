# KULT World Experience Registry

`KultWorldExperienceRegistry.sol` records portable Agent experience receipts without calculating a universal reputation score.

## Trust classes

- `registerAndAnchor`: the Agent wallet publishes a **self-attested** receipt.
- `issueVerifiedExperience`: an owner-authorized issuer publishes an **issuer-verified** receipt for an already registered Agent.
- Consumers can distinguish both with `verifiedIssuer` and `issuer`.

Agent keys are wallet-bound: `keccak256(wallet, localAgentId)`. Reusing a public local Agent ID from another wallet therefore cannot seize or poison the original Agent. Receipt replay protection is scoped to the wallet-bound Agent key.

## Season rules commitment

`commitSeasonManifest(seasonId, manifestHash)` lets the registry owner publish the exact rules hash before the Season opens. A Season ID can be committed only once. This commits scoring, capability and evolution rules—not future Agent outcomes.

Generate the exact Season 01 values from the application root:

```bash
node -e "const s=require('./season'); console.log(s.seasonIdHash, s.manifestHash)"
```

Then call the function once and configure the successful transaction as `KULT_SEASON_COMMIT_TX`.

## Compact browser protocol

The fallback accepts exactly 129 bytes so the zero-dependency frontend can anchor a structured receipt without ABI/Web3 packages:

```text
0x01 | localAgentId | receiptId | evidenceHash | metadata
  1       32            32            32           32 bytes
```

The metadata word packs `domain:uint8 | outcome:uint8 | difficulty:uint16` into its low four bytes.

| Value | Meaning |
|---|---|
| Domain 1 | analysis |
| Domain 2 | creativity |
| Domain 3 | strategy |
| Domain 4 | social |
| Outcome 1 | success |
| Outcome 2 | miss |

## Test

```bash
forge test -vvv
```

## Deploy to Robinhood Chain Testnet

```bash
export ROBINHOOD_RPC_URL=https://your-managed-robinhood-rpc
export DEPLOYER_PRIVATE_KEY=0x...

forge create contracts/KultWorldExperienceRegistry.sol:KultWorldExperienceRegistry \
  --rpc-url "$ROBINHOOD_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast
```

Then set the deployed address as `KULT_REGISTRY_ADDRESS`, restart the application, complete one real mission and execute an end-to-end anchor from a throwaway test wallet.

Never commit a funded key. Transfer ownership through the two-step `transferOwnership` / `acceptOwnership` flow. Before mainnet or material value, commission an independent audit, publish verified source and move ownership to a reviewed multisig/timelock policy.
