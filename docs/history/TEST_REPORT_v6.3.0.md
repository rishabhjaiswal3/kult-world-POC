# KULT World v6.3.0 — Final Test Report

## Automated application suite

- tests: 52
- passed: 52
- failed: 0

## Coverage

- lines: 88.26%
- branches: 59.78%
- functions: 83.39%

Key module line coverage:

- A2A marketplace: 97.67%
- Market Arena: 82.27%
- Perps Game: 98.74%
- Pulse Engine: 95.77%
- SQLite Store: 91.19%
- World Runtime: 100%
- X Layer Market: 100%

## Production-mode HTTP smoke

Passed with SQLite persistence and a real server process. The script exercised Agent adoption, world runtime, Pulse, A2A and Perp Wars, then terminated the process gracefully and restarted against the same database.

Observed final smoke summary:

```json
{
  "ok": true,
  "version": "6.3.0",
  "persistence": { "ok": true, "check": "ok", "persistence": "sqlite" },
  "pulseStatus": "running-persisted",
  "a2aReceipts": 1,
  "marketStatus": "observing-persisted",
  "restartPersistence": true,
  "releaseScope": "public-beta-demo"
}
```

## Market preflight

Simulator preflight passed:

- demoOnly: true
- account level: demo
- position mode: net_mode
- BTC/ETH/SOL checked
- openPositions: []
- writesPerformed: 0

## Environment limitations

- local runtime used for these tests was Node 22.16.0; production target is Node 24.15+ and Dockerfile is pinned to Node 24 family
- Foundry was unavailable, so contract tests were not executed
- Docker CLI was unavailable, so the image build itself was not executed here
- no headless browser engine was available for automated WebGL visual screenshots
- no private OKX Demo credentials were used in this environment

The production certification therefore applies to the application/public-beta scope defined in `PRODUCTION_CERTIFICATION_v6.3.0.md`, not to excluded rails.
