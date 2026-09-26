# KULT World v6.3.0 — Production Certification

**Decision:** APPROVED for a **single-instance public beta/demo deployment** under the scope below.

## Approved scope

- Node.js 24.15+ target runtime
- HTTPS deployment
- persistent SQLite on durable disk
- one application instance
- KULT World cinematic frontend + backend runtime
- Agent Tower / AI Arena / Portal shell
- Pulse server simulation
- A2A simulated settlement
- KULT Perp Wars simulator
- supervised OKX Agent Trade Kit **Demo Trading only** after account preflight
- proof rail disabled by default

## Certification evidence

- 52/52 application tests passed
- 88.26% line coverage
- 59.78% branch coverage
- 83.39% function coverage
- production-mode SQLite integrity check passed
- graceful restart/persistence smoke passed
- Pulse/A2A/market state persistence exercised over HTTP
- market preflight passed with zero open positions and zero writes in simulator
- deployment kill-switch ceiling, timed WAIT, durable execution intent and durable lease covered by tests

## Explicit exclusions

This certification is **not** approval for:

- live-money trading
- custody or pooled user capital
- live BNB/Pulse execution
- real paid A2A settlement
- autonomous financial execution with real funds
- multiple application instances
- contract/proof rails not separately verified

## Promotion gates beyond public beta

Live-money promotion requires a separate architecture and certification covering account isolation, authoritative fills/fees/funding, partial fills, venue failure recovery, load/chaos testing, independent security review, and launch-jurisdiction legal/compliance review.

Horizontal scaling requires shared transactional/versioned owner writes and distributed mutation coordination.

Optional proof rails require Foundry tests, deployment verification and independent contract review.
