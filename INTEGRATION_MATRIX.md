# KULT World v6.5.0 — Integration Matrix

| Surface | Authority | v6.5 status | Settlement / execution |
|---|---|---|---|
| Agent Core | KULT backend + SQLite | Integrated | persistent identity, memory, capabilities |
| Three.js World | KULT frontend | Integrated | backend-driven runtime state |
| AI Arena | KULT | Integrated | game/intelligence progression |
| Perp Wars | KULT + OKX adapter | Integrated | simulator by default; supervised OKX Demo supported |
| Pulse | KULT | Integrated test rail | server-owned simulation; no live BNB claim |
| A2A discovery/negotiation | Existing A2A marketplace | External authoritative service | real marketplace UI/API |
| A2A payment | GOAT Flow | Existing external rail | DELEGATE/x402-style flow |
| A2A escrow | A2AJobEscrow on Base | Existing deployed contract | USDC escrow / payout / refund |
| A2A callback | KultGoatReceiver on Base | Existing deployed contract | payer credit + `fundJob` only |
| Agent identity for A2A | ERC-8004 on Base | Existing external identity rail | agent-wallet binding enforced by escrow |
| X Layer battle receipt | KULT optional adapter | Optional | testnet-first proof rail |
| OKX.AI | KULT service endpoints | A2MCP-ready | free endpoints; paid settlement external |

## Real A2A bridge boundary

KULT does not create a second job database or move A2A funds itself.

Known bridged routes:

- open GOAT order
- submit buyer calldata signature
- read GOAT order state
- read unbound payer credit

The existing marketplace remains responsible for job ownership, negotiation, signed agreements, provider selection, verifier flow, disputes and reconciliation.
