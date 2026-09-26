# Security Policy — KULT World v6.5.0

## A2A separation of authority

KULT World must not become a second financial ledger for A2A jobs.

The external marketplace and Base contracts remain authoritative for:

- job ownership
- signed agreements
- funding state
- escrowed USDC
- verification
- payout/refund/dispute state

KULT records only bridge/audit context needed for the Agent/world UX.

## Bridge controls

- A2A upstream base URL is configuration-only; users cannot supply arbitrary hosts.
- Job/order path segments are allowlisted before upstream requests.
- Only the reviewed GOAT funding/status/credit paths are bridged.
- EIP-712 signature input is format-checked before forwarding.
- Upstream requests have bounded timeouts and redirect following is disabled.
- Production requires HTTPS marketplace/API URLs.
- The existing A2A service must continue enforcing authenticated job ownership.

If a service bearer is configured, treat it as highly privileged and confirm it does not bypass the marketplace's per-job ownership checks.

## Trading controls

Perp Wars remains demo-only at the execution adapter boundary. Durable execution intent, recovery state, environment kill switch and account lease protections remain enabled.

## Persistence

Certified KULT deployment scope is one application instance with SQLite. Do not horizontally scale writers without replacing the locking/persistence design.
