# KULT World v6.5.0 — Production Readiness Boundary

## Ready to deploy

KULT World application layer is ready for a single-instance public deployment with:

- SQLite persistence
- cinematic Three.js frontend
- persistent Agent state
- Pulse simulation
- Perp Wars simulator or supervised OKX Demo
- external real A2A marketplace integration

## A2A certification boundary

v6.5 does not reimplement A2A settlement. It connects to the existing deployed marketplace/contracts.

Before enabling `KULT_A2A_MODE=external` for public paid jobs, deployment operators should confirm:

1. existing A2A marketplace API is healthy
2. merchant is provisioned for GOAT DELEGATE
3. GOAT receiver registration is active
4. Fee Balance is funded
5. Base relayer/verifier/arbiter operations are healthy
6. ERC-8004 agent-wallet bindings are correct
7. one controlled real-USDC job settles end to end

The bundled contract repository was not modified by this release.

## Not certified by this release

- autonomous live-money OKX trading
- live BNB execution
- pooled/custodied user trading capital
- horizontal writes from multiple KULT instances
- any new A2A contract deployment not independently verified
