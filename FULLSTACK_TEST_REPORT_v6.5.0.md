# KULT World v6.5.0 — Full-Stack Test Report

## Final KULT release gate

`npm run verify:release` passed.

- KULT tests: **52/52 passing**
- failures: **0**
- line coverage: **86.54%**
- branch coverage: **58.87%**
- function coverage: **81.38%**

## Real A2A integration verification

### Bridge module smoke — PASS

Verified against a controlled mock upstream:

- A2A health
- GOAT order creation
- buyer EIP-712 signature submission
- GOAT order status
- payer unbound-credit read
- configured service authorization forwarding

### KULT server → A2A service smoke — PASS

Verified through KULT HTTP routes:

- Agent adoption/session boundary
- real-settlement A2A state
- real marketplace launch URL
- `/api/a2a/health`
- GOAT order proxy
- signature proxy
- order-status proxy
- payer-credit proxy
- KULT bridge audit events

### Production external-A2A configuration — PASS

Production-mode server booted with `KULT_A2A_MODE=external` and reported:

- mode: `goat-base-external`
- paid settlement: `true`
- Base mainnet escrow configured
- KultGoatReceiver configured

## KULT full-stack smoke — PASS

Verified:

- backend serves frontend
- backend-driven World Runtime
- Pulse integration
- Perp Wars integration
- SQLite restart persistence

## Production core smoke — PASS

Production-mode KULT core was also tested with A2A deliberately disabled, proving the world can stay available if the external marketplace is taken out of service.

## Market preflight — PASS

- adapter: simulator
- demo-only: true
- BTC / ETH / SOL checked
- open positions: 0
- writes performed: 0

## Bundled A2A repository integrity

The bundled `integrations/a2a-goat-marketplace/` source was compared against the user-uploaded repository after removing partial `node_modules` install residue: **no source differences**.

## Contract-suite limitation

The A2A repository's dependency installation timed out in this environment, so its Hardhat suite was **not rerun here**. The repository is bundled unchanged; this KULT release verifies the integration boundary, not a new Solidity audit.
