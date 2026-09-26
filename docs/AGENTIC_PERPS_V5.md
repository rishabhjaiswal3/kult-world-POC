# KULT Perp Wars v5 — Architecture Contract

KULT Perp Wars is the gamified perpetuals district inside KULT World. It keeps the **same persistent KULT Agent** and gives that Agent a new Market Intelligence domain rather than creating a disposable trading bot.

## Product boundaries

### KULT owns
- persistent Agent identity, personality and Market Memory;
- Agent and rival reasoning;
- raid matchmaking/presentation;
- risk policy and explicit user authorization;
- raid scoring, rating, loot, territory, Citadel and skills;
- reflection and persistent experience;
- X Layer receipt eligibility and verification;
- OKX.AI-facing service contracts.

### OKX Agent Trade Kit owns
- authenticated OKX market/account access;
- ticker, candles, funding, order book and position reads;
- demo leverage/order/close commands;
- exchange order/position identifiers used for reconciliation.

Every command produced by the KULT adapter is demo-scoped. v5 intentionally has no live switch.

### X Layer owns
- optional public battle receipt/proof rail;
- future game-economy and Agent-payment settlement primitives.

Perpetual positions themselves are not executed on X Layer.

### OKX.AI
v5 exposes A2MCP-ready KULT capabilities. External requests address a KULT `agentId` and are accepted only after that Agent has opted into a public Passport; private memories/arena state are not returned. It does not claim registration until the deployed HTTPS endpoints are actually submitted/approved in OKX.AI. Paid x402/Agent Payments are a follow-on integration, not mocked by this package.

## Raid state machine

```text
PREPARED
  ├─ WAIT → RESOLVED
  └─ EXECUTING
       ├─ ACTIVE
       │    └─ CLOSING
       │         └─ CLOSED
       │              └─ RESOLVED
       └─ RECOVERY_REQUIRED

EXECUTING / CLOSING / RECOVERY_REQUIRED
       └─ RECONCILE → appropriate durable state
```

`PREPARED` has a 60-second TTL. Execution rechecks the position, equity, market snapshot, spread, price drift and access/risk controls immediately before the side effect.

## Shared OKX demo account rule

The KULT World has per-owner raid state, but one configured Agent Trade Kit profile maps to one exchange account. v5 therefore uses a **process-global execution lease** to serialize Agent-Kit side effects on the controlled single-instance deployment.

This is correct for the partner/demo deployment profile; it is not horizontal-scale account isolation. Before multi-instance/public concurrent execution, replace it with a distributed lease plus explicit account/profile routing or isolated exchange accounts.

## Agent decision contract

A player Agent and selected rival independently consume the same frozen market snapshot. The player's decision is conditioned by its persistent state and recent market memories. Rival archetypes begin with distinct biases. Valid actions are:

```text
LONG | SHORT | WAIT
```

WAIT must remain meaningful. The progression model must not reward meaningless volume as the dominant strategy.

## Progression

Market progression is domain-specific and separate from verified Passport capability:

```text
Rating / Rank
Season Points
Loot
Territory
Citadel Level
Raid Streak
Rival Wins
Momentum
Risk
Order Flow
Contrarian
Calibration
Memory
```

The raid journal stores a reflection after resolution. Experience may grow after a miss; verified skill/capability evidence is not manufactured from market play.

## X Layer receipt

The compact payload is 129 bytes:

```text
0x02 | battleId:bytes32 | agentId:bytes32 | tradeHash:bytes32 | metadata:bytes32
```

Metadata packs:
- duel outcome: `1 win`, `2 loss`, `3 draw`;
- player market return in signed basis points.

The server verifies chain, success, target registry, sender and exact calldata before persisting the anchor. Private reasoning/memory never goes on-chain.

## Three.js contract

`static/perps3d.js` is presentation only. It receives sanitized state through `kult:perps-state` and cannot place orders or mutate authoritative progression. The accessible DOM UI is the gameplay/control plane and continues to work without WebGL.

## Go-live gates

1. `npm run check` and `npm test` green.
2. `npm run market:preflight` green against the dedicated OKX demo profile.
3. One complete BTC raid: prepare → execute → close → resolve.
4. Kill the app once after external execution and verify reconcile/recovery behavior before partner use.
5. Deploy `KultMarketBattleRegistry.sol` to the selected X Layer network and anchor one throwaway receipt.
6. Keep one application instance for v5.
7. Register OKX.AI services only after public HTTPS URLs and response schemas are frozen.
8. Do not enable live-money execution from this branch.
