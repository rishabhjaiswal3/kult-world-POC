# KULT World v6 Frontend Architecture

## Product thesis
KULT World is the living world where one persistent AI Agent develops intelligence through real experiences. Chains and venues are infrastructure; the Agent is the product.

## Scene architecture
The Three.js world contains six dense districts around a central KULT Core:

1. Agent Tower — identity, memory, evolution and Agent Lab.
2. AI Arena — Agent-v-Agent proving ground.
3. Market Citadel — deeper OKX Perp Wars.
4. Pulse District — fast BNB market-round shell.
5. A2A Exchange — Agent capability commerce.
6. Portal Hub — KULT games and future creator/partner experiences.

## UX rule
- Three.js: navigation, presence, progression, live world activity and visual consequences.
- HTML/CSS: charts, trading decisions, wallet actions, memory inspection, Agent configuration and commerce confirmations.
- Never force users to walk through 3D to complete frequent actions.

## Adapter boundaries
### Market Citadel
Uses the existing v5 OKX Agent Trade Kit Demo execution flow. No change to the hard demo-only execution guard in this release.

### Pulse
Frontend only. The UI demonstrates 5m/15m/60m Agent decisions and Follow / Override / WAIT. It deliberately does not simulate a real BNB transaction or claim venue liquidity.

### A2A
Frontend only. Service listings are product mock data; no payment executes. A future adapter should preserve capability request -> quote -> payment -> result -> reputation semantics.

## Persistent Agent requirement
All environments should eventually write contextual experience records keyed by environment, venue, asset/game, horizon, regime/setup, action, confidence, outcome and lesson. Cross-environment learning should be measured, not inferred from generic XP.

## Performance
- Procedural geometry only; no required 3D textures.
- DPR capped.
- Low-poly structures and ambient travelers.
- Reduced-motion and data-saving fallbacks.
- DOM labels remain accessible when WebGL fails.
