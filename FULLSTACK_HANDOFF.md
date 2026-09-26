# KULT World v6.5.0 — Full-Stack Handoff

## Deployable components

1. KULT World Node application (`server.js` + `static/`)
2. SQLite persistence
3. Three.js world and Agent frontend
4. Pulse server engine
5. Perp Wars + OKX Demo adapter boundary
6. Real A2A external bridge (`a2a-goat-bridge.js`)
7. Bundled A2A contract/protocol source under `integrations/a2a-goat-marketplace/`

## Production A2A topology

```text
Browser
  ↓
KULT World
  ↓ opens / bridges reviewed funding calls
Existing A2A marketplace service
  ↓
GOAT Flow
  ↓
KultGoatReceiver
  ↓
A2AJobEscrow
  ↓
Base USDC settlement
```

Do not replace the external marketplace with the legacy `a2a-marketplace.js` simulation in production.

## Deployment acceptance

Run:

```bash
npm run verify:fullstack
```

Then configure the real A2A URLs and verify:

```bash
curl https://<kult-host>/api/a2a/health
```

Finally run one controlled real marketplace job using the marketplace's existing runbook and confirm Base events before announcing live settlement.
