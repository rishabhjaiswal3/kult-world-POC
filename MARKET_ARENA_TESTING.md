# KULT Perp Wars v5 — Test Guide

## 1. Zero-credential full game smoke

```bash
npm test
npm run check
KULT_MARKET_ADAPTER=sim KULT_MARKET_ACCESS=enabled npm start
```

Open `http://localhost:8060`:

1. Adopt/select a KULT Agent.
2. Enter **Perp Wars / Market Citadel**.
3. Select a rival and BTC, ETH or SOL.
4. Prepare a raid and inspect both independent theses.
5. If the Agent chooses WAIT, bank the WAIT decision and verify progression/journal changes without a position.
6. Otherwise execute, close, reconcile if needed, then resolve.
7. Verify rating, season points, loot, skills, Citadel level and journal update.
8. Reload the page and confirm progression persists.

## 2. OKX Agent Trade Kit demo smoke

Configure a dedicated OKX Demo Trading profile/credentials, then:

```bash
KULT_MARKET_ADAPTER=agent-kit \
KULT_MARKET_ACCESS=enabled \
OKX_API_KEY=... \
OKX_SECRET_KEY=... \
OKX_PASSPHRASE=... \
npm run market:preflight
```

Only continue if preflight reports a demo-only healthy adapter and valid positive demo equity.

Start the app with the same environment and run **one raid at a time** on the single supported application instance. Confirm the OKX demo position appears after Execute and is flat after Close/Reconcile before Resolve.

## 3. Reliability checks

- Prepare a battle and wait >60 seconds: Execute must reject the stale thesis.
- Set `KULT_MARKET_ACCESS=paused`: new Prepare/Execute must fail; Close/Reconcile/Resolve must remain available.
- Simulate/force an execution adapter failure after the external call boundary: battle must be recoverable (`RECOVERY_REQUIRED`) rather than blindly retried.
- Attempt a second Agent-Kit execution while the shared execution lease is held: it must be blocked.
- Verify unavailable/invalid Agent-Kit equity blocks execution instead of using simulator equity.

## 4. X Layer receipt

Default network is testnet:

```bash
KULT_XLAYER_NETWORK=testnet
XLAYER_TESTNET_RPC_URL=https://testrpc.xlayer.tech/terigon
KULT_MARKET_XLAYER_REGISTRY=0x...
```

For mainnet only after the registry and UX are reviewed:

```bash
KULT_XLAYER_NETWORK=mainnet
XLAYER_RPC_URL=https://rpc.xlayer.tech
KULT_MARKET_XLAYER_REGISTRY=0x...
```

Resolve an eligible OKX Agent-Kit raid, connect the EVM wallet used as the KULT proof identity, request `/api/market/xlayer/calldata`, submit the returned transaction, then call `/api/market/xlayer/anchored`. Confirm the server verifies chain, target, sender, status and exact calldata.

## 5. OKX.AI service contract smoke

Check:

```text
GET  /api/okx-ai/manifest
GET  /api/okx-ai/services
GET  /api/okx-ai/agent-profile
POST /api/okx-ai/market-read       { "symbol": "BTC" }
POST /api/okx-ai/raid-evaluate    { "battleId": "..." }
```

These endpoints are currently free. Do not claim OKX.AI registration or x402 charging until separately configured and verified.

## 6. Contract suite

With Foundry installed:

```bash
npm run test:contract
```

The suite covers the World Experience Registry and the compact Perp Wars X Layer receipt registry.
