# KULT Perp Wars — OKX Agent Trade Kit Architecture

Version: `6.5.0`

This document is the OKX execution boundary for the Perp Wars district. For the complete Agent/game architecture see `AGENTIC_PERPS_V5.md`.

## Execution contract

- Official OKX Agent Trade Kit CLI is the exchange adapter.
- All KULT-generated commands include `--demo`.
- Supported instruments: `BTC-USDT-SWAP`, `ETH-USDT-SWAP`, `SOL-USDT-SWAP`.
- Cross margin; max leverage 3×.
- Notional is server-derived: `min($500, 5% demo equity)`.
- Agent-Kit equity is fail-closed if unavailable or invalid.
- The browser supplies neither authoritative notional nor leverage.
- User sees the thesis first and separately confirms execution.
- Prepared thesis expires after 60 seconds; market/risk/account state is revalidated immediately before execution.
- `EXECUTING` and `CLOSING` are persisted before exchange side effects. Ambiguity enters `RECOVERY_REQUIRED` and must reconcile rather than blindly retry.
- One process-global Agent-Kit execution lease protects the single shared demo account in the supported one-instance deployment.

## HTTP flow

```text
GET  /api/market/health
GET  /api/market/ready
GET  /api/market/state
GET  /api/market/snapshot?symbol=BTC
POST /api/market/battle/prepare   { symbol, rivalId }
POST /api/market/battle/execute   { battleId }
POST /api/market/battle/abstain   { battleId }
POST /api/market/battle/close     { battleId }
POST /api/market/battle/reconcile { battleId }
POST /api/market/battle/resolve   { battleId }
POST /api/market/battle/cancel    { battleId }
```

Optional X Layer proof:

```text
POST /api/market/xlayer/calldata { battleId }
wallet submits returned tx
POST /api/market/xlayer/anchored { battleId, txHash }
```

## Agent Trade Kit command boundary

Representative reads:

```text
okx --demo market ticker BTC-USDT-SWAP --json
okx --demo market funding-rate BTC-USDT-SWAP --json
okx --demo market candles BTC-USDT-SWAP --bar 5m --limit 12 --json
okx --demo market orderbook BTC-USDT-SWAP --sz 5 --json
okx --demo account balance --json
okx --demo account config --json
okx --demo account positions --instType SWAP --instId BTC-USDT-SWAP --json
```

Representative write path after explicit authorization:

```text
okx --demo swap leverage --instId BTC-USDT-SWAP --lever 3 --mgnMode cross --json
okx --demo swap place --instId BTC-USDT-SWAP --side buy --ordType market --sz <server-derived> --tgtCcy quote_ccy --tdMode cross --json
```

The adapter then captures order/position state and later uses the official close path followed by position reconciliation.

## Known deployment boundary

A KULT owner is not the same thing as an OKX exchange account. v5 is intentionally hardened for one shared demo profile on one application instance. Do not horizontally scale this execution mode without distributed locking and account/profile isolation.
