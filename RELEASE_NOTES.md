# KULT World v6.5.0 — Real A2A Integration

v6.5 replaces the production A2A simulation with a bridge to the existing A2A marketplace.

## Added

- `a2a-goat-bridge.js`
- real A2A marketplace launch from the Three.js A2A district
- GOAT order creation bridge
- buyer calldata-signature bridge
- GOAT order status bridge
- unbound payer credit bridge
- `/api/a2a/health`
- Base contract metadata in runtime/integration APIs
- A2A bridge smoke test
- KULT server → A2A end-to-end proxy smoke test
- bundled original A2A GOAT/Base repository

## Removed from production path

- duplicate KULT-side A2A payment ledger
- fake/demo USDC balance as a production concept
- simulated hire as the production A2A action

The legacy simulator remains only for local development/testing.
