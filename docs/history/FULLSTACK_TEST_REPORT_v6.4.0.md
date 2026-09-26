# KULT World v6.4.0 — Full-Stack Test Report

## Result

PASS for the certified public-beta/demo scope.

## Automated verification

- `npm run check` — passed
- `npm test` — 52/52 passed
- `node scripts/fullstack-e2e.js` — passed
- `KULT_MARKET_ADAPTER=sim node scripts/market-preflight.js` — passed, zero writes

## End-to-end path verified

1. Backend boots in production mode against SQLite.
2. Backend serves `static/index.html`, `app.js`, `world3d.js`, and `market.js`.
3. Frontend source is wired to `/api/world/runtime` and `/api/market/*`.
4. `/api/integrations` reports the runtime adapter boundary.
5. Agent adoption succeeds.
6. World runtime returns Agent state.
7. Pulse prepare/commit persists server state.
8. A2A hire creates a completed persistent receipt.
9. Perp Wars reaches either the execution lifecycle or timed WAIT observation lifecycle.
10. Server shuts down and restarts.
11. Agent state and A2A receipts survive restart.
12. Market preflight checks BTC/ETH/SOL, finds zero open positions and performs zero writes.

## Certified scope

- cinematic Three.js frontend + backend in one deployable service
- persistent Agent state
- SQLite single-instance persistence
- Pulse server simulation
- A2A simulated settlement
- Perp Wars simulator
- supervised OKX Demo adapter after separate credential/preflight verification
- OKX.AI service/manifest surface
- X Layer receipt adapter when separately configured

## Not certified as live

- autonomous real-money trading
- live BNB execution
- paid A2A settlement/x402/B402
- horizontal multi-instance writes
- optional proof contracts until independently tested/deployed
