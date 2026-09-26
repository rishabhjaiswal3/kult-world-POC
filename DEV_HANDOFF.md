# Developer handoff

## Architecture

| Layer | File | Responsibility |
|---|---|---|
| HTTP/security | `server.js` | opaque sessions, API projections, origin/rate controls, public pages |
| Simulation | `engine.js` | bounded Agent state, lived World experience, evidence-bearing missions, streaks and memory |
| Growth | `growth.js` | moments, challenges, creators, follows and leaderboard |
| Chain verification | `chain.js` | compact calldata and independent JSON-RPC verification |
| Season commitment | `season.js` | canonical launch rules, deterministic hash and public campaign phases |
| Dynamic social art | `og.js` | dependency-free 1200×630 PNG generation for public surfaces |
| Persistence | `sqlite-store.js` / `store.js` | transactional SQLite production profile; JSON migration/dev fallback |
| Client | `static/` | responsive game, Three.js World layer, Community, Passport and wallet UX |
| Registry | `contracts/` | wallet-bound self-attested and issuer-verified receipts |
| Intelligence | `intelligence.js` | bounded 0G decisions with deterministic fallback and allowlists |
| Identity | `identity.js` | standalone opaque sessions or signed KULT gateway owner mapping |
| Integrations | `sdk/` | public read client and canonical encoder |

## Important invariants

- Raw session/recovery credentials never appear in world, challenge, creator, share or public Passport records.
- A public response is always a projection; never return `store.getWorld()` or a full owner.
- Capability changes only through recorded outcomes.
- Visual evolution is derived only by `engine.evolutionFor`; never duplicate thresholds in the client or growth layer.
- A committed Season manifest is immutable. Threshold changes require a new Season ID.
- Community actions never grant Credits/capability or influence leaderboard scores.
- Challenge accept/beat counts are sets keyed by Agent ID, not replayable counters.
- Wallet claimed and wallet verified are distinct states.
- Anchoring requires exact server-generated calldata and independent RPC verification.
- Autonomous World life creates lived experience only; capability evidence comes from bounded missions/authorized issuers.
- Production uses SQLite on one application instance. JSON is local/dev only.
- 0G may choose only allowlisted World actions and never gains financial, proof or permission authority.

## API errors

Frontend behavior should branch on stable `code`, not English text. Important values include `agent_required`, `origin_rejected`, `registry_unavailable`, `wallet_required`, `proof_not_found`, `tx_pending`, `tx_reverted`, `wrong_chain`, `wrong_target`, `wrong_sender` and `wrong_evidence`.

## Next scale milestone

The controlled production profile is complete on transactional SQLite. For multi-instance/global scale, move users/sessions, Agents, evidence, receipts, challenges, follows and analytics to Postgres; shared rate limits/catch-up locks to Redis; and event fan-out to NATS. Preserve public random IDs, unique constraints, idempotency and evidence semantics exactly.

Read `PRODUCT_CONCEPT.md` before changing the loop, progression or trust language. Use `DEPLOYMENT.md` for the exact release sequence.
