# KULT World v6.5.0 — Full-Stack + Real A2A Integration

KULT World v6.5.0 is the deployable full-stack build for the persistent-Agent world.

It combines:

- cinematic Three.js KULT World frontend
- persistent Agent backend and SQLite state
- AI Arena / Agent Tower / Portal surfaces
- KULT Perp Wars with simulator or supervised OKX Demo execution
- Pulse server-owned market rounds
- real A2A marketplace integration using the existing GOAT Flow + Base USDC escrow stack

## Important architecture rule

KULT World does **not** duplicate the A2A marketplace ledger.

The existing A2A marketplace remains authoritative for jobs, negotiation, GOAT payment flow, Base escrow, verification, refunds and settlement. KULT World provides the world/Agent experience layer and a constrained bridge to the reviewed GOAT routes.

```text
KULT Agent
   │
   ├─ Perp Wars ── OKX Demo
   ├─ Pulse ────── server-owned simulation
   └─ A2A Exchange
          │
          └─ Existing A2A marketplace
                 │
                 ├─ ERC-8004 identity
                 ├─ GOAT Flow DELEGATE
                 ├─ KultGoatReceiver
                 ├─ A2AJobEscrow
                 └─ Base USDC settlement
```

## A2A contracts bundled in this release

The user-supplied A2A repo is included unchanged under:

`integrations/a2a-goat-marketplace/`

Base mainnet defaults from that repository:

- A2AJobEscrow: `0xE4F7cB9aAf7dC9f800Cb3C1ea2c26696B2CEBEa3`
- KultGoatReceiver: `0xD1fc9b992AEa52f8d91c6B49A3FDe21Cf3Ed307E`
- ERC-8004 registry: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- Base USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

## Production modes

### A2A

Production should use either:

```text
KULT_A2A_MODE=external
```

or deliberately disable A2A:

```text
KULT_A2A_MODE=disabled
```

`sim` is development-only.

For external mode configure:

```text
KULT_A2A_API_URL=https://<marketplace-api>
KULT_A2A_CHAIN_API_URL=https://<chain-access-service>
KULT_A2A_MARKETPLACE_URL=https://<marketplace-ui>
```

KULT exposes these bridge routes:

- `POST /api/a2a/jobs/:jobId/goat/orders`
- `POST /api/a2a/jobs/:jobId/goat/orders/:orderId/signature`
- `GET /api/a2a/jobs/:jobId/goat/orders/:orderId`
- `GET /api/a2a/goat/credit/:payer`
- `GET /api/a2a/health`

The A2A district primarily launches the existing marketplace UI so its own auth, job negotiation and ownership model remain authoritative.

### Perp Wars

Safe default:

```text
KULT_MARKET_ADAPTER=sim
```

Promotion path:

```text
sim → OKX Demo preflight → agent-kit supervised demo
```

Live-money autonomous trading is **not** certified by this build.

### Pulse

Pulse remains server-owned simulation in v6.5. It has its own adapter boundary and does not claim live BNB execution yet.

## Quick start

Requires Node 24.15+ for the intended deployment runtime.

```bash
npm install
KULT_PERSISTENCE=sqlite \
KULT_DATA_DB=./data/kult-world.sqlite \
KULT_MARKET_ADAPTER=sim \
KULT_MARKET_ACCESS=enabled \
KULT_PULSE_REFERENCE_ADAPTER=sim \
KULT_A2A_MODE=disabled \
npm start
```

Open:

`http://localhost:8060`

For real A2A integration, replace `KULT_A2A_MODE=disabled` with `external` and provide the marketplace URLs.

## Verification

```bash
npm run verify:fullstack
```

Individual gates:

```bash
npm test
npm run smoke:a2a
npm run smoke:a2a-e2e
npm run smoke:fullstack
npm run smoke:production
npm run market:preflight
```

## Current verified boundary

Verified in this environment:

- 52/52 KULT tests passing
- KULT backend serves frontend
- SQLite restart persistence
- World Runtime / Pulse / Perp Wars integration
- A2A bridge module against mock upstream
- KULT server → A2A proxy routes against mock upstream
- production-mode KULT restart smoke with A2A disabled
- zero-write market preflight

Not claimed here:

- a fresh rerun of the bundled A2A Hardhat suite (dependency install timed out in this environment)
- live GOAT merchant API payment with real USDC during this session
- live-money OKX trading
- live BNB execution
- horizontal multi-instance deployment

See `DEPLOYMENT.md`, `INTEGRATION_MATRIX.md`, `FULLSTACK_TEST_REPORT_v6.5.0.md`, and `SECURITY.md` before deployment.
