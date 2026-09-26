# KULT World — product concept and build contract

## The product in one sentence

KULT World is a persistent Agent world where a person adopts one identity, shapes it through choices, and watches its capabilities, appearance, home and public reputation evolve from recorded outcomes that can be independently verified on Robinhood Chain.

## The discipline

> Every evolution is earned. Every capability is evidenced. Every proof is verifiable.

KULT World is not a yield farm, rarity mint or universal reputation score. Money, follows, wallet balance and token ownership never improve capability. The number goes up only because the Agent attempted something and the outcome was recorded.

## Player fantasy

The player should feel: “This Agent is becoming mine because of what we experienced together.”

The emotional object is the Agent. Robinhood Chain is the trust rail used when an earned event is worth making portable. A wallet is optional for the game and required only when the owner chooses to anchor a receipt.

## Core loop

1. **Adopt** one of six starting identities.
2. **Direct** what the Agent should explore, learn, create, compete in or earn from.
3. **Leave** and let bounded autonomous activity continue.
4. **Return** to memories, relationships and evidence from real outcomes.
5. **Choose** during a mission; the Agent recommends but the player decides.
6. **Prove** an earned receipt on Robinhood Chain when desired.
7. **Evolve** the Agent's form, home signal and badge from capability evidence.
8. **Share or challenge** through public Passports, moments and comparable benchmarks.

## What is simulated and what is proven

| Layer | Meaning | Source of truth |
|---|---|---|
| Personality, memory and relationships | Private identity and attachment | KULT application state |
| Mission outcome | What happened in a bounded activity | Server-authoritative KULT engine or authorized external issuer |
| Capability | Bayesian evidence view per domain | Deterministic derivation from recorded successes/misses |
| Evolution | Visible expression of the strongest proven capability tier | Canonical engine tier rules |
| Receipt integrity | Evidence existed in this exact form at anchoring time | Robinhood Chain registry |
| Season rules | Scoring/evolution rules were not changed after launch | Immutable Season manifest commitment |

The chain proves publication, integrity, sender and time. It does not magically prove that an off-chain judgment was correct. That distinction must remain visible in the UI.

## Capability and visible evolution

There are four independent capability domains: analysis, creativity, strategy and social.

| Visible form | Capability requirement | Visual unlock |
|---|---|---|
| Emerging | Starting state | Base form and starter home |
| Capable | Score ≥58 with ≥7 outcomes in one capability | Capability aura and earned home signal |
| Skilled | Score ≥72 with ≥14 outcomes in one capability | Resonant form, orbit and district crest |
| Elite | Score ≥82 with ≥24 outcomes in one capability | Radiant form, crown flare and elite environment |

The highest legitimately reached capability tier determines the visible form. Evolution cannot be purchased. A miss remains evidence and can reduce confidence or score; it is never erased to protect aesthetics.

The rules live in three synchronized places:

- `engine.js`: runtime source of truth.
- `season.js`: canonical public Season manifest and hash.
- `contracts/KultWorldExperienceRegistry.sol`: immutable manifest commitment plus receipts.

Any future change requires a new Season manifest, not a silent threshold edit.

## Provenance model

KULT borrows commit-before-reveal as a trust pattern, not as randomized rarity.

1. Commit the Season ID and exact manifest hash before launch.
2. Record each mission outcome as it happens.
3. Compute a receipt ID, wallet-bound Agent ID and evidence hash.
4. Optionally anchor the exact receipt payload on Robinhood Chain.
5. Expose a public `/verify/:agentId` timeline that distinguishes:
   - **Recorded** — present in the KULT evidence history.
   - **Anchored** — published by the Agent wallet on the registry.
   - **Issuer verified** — published by an owner-authorized external issuer.

Public verification is opt-in. Private memory, full wallet address, recovery credentials and mission choices never appear in the public Passport.

## Community and growth loop

The Town Square is the launch/community layer, not a fake chat room. It contains real Season rules, real contributors, public creators, open challenges and earned moments.

The growth loop is:

`outcome → evidence → capability → visible evolution → public proof → share card → challenge → new/returning player`

Dynamic 1200×630 PNG cards are generated for every public moment, challenge, Passport and Season page. Public pages include crawler-readable Open Graph and X metadata.

## Product surfaces

| Surface | Purpose |
|---|---|
| `/` | Adoption, persistent world, missions, Community and private Passport |
| `/season/01` | Town Square promise, rules and on-chain manifest commitment |
| `/passport/:agentId` | Public identity and evidence-derived capability summary |
| `/verify/:agentId` | Public provenance timeline with evidence hashes and explorer links |
| `/s/:slug` | Earned moment landing page and dynamic share card |
| `/c/:id` | Comparable Agent-vs-Agent challenge landing page |
| `/api/*` | Public projections and session-bound game actions |

## Non-negotiable integrity rules

- No wallet is required for adoption or gameplay.
- No financial balance changes capability.
- No follow, share or creator action changes ranking.
- No failed outcome is deleted from capability evidence.
- No pasted transaction hash is trusted without independent RPC verification.
- No raw owner/session/recovery ID is stored in public world records.
- No public endpoint returns the private Agent object.
- No self-attested receipt is labeled independent verification.
- No Season threshold changes after the manifest is committed.

## Launch definition

The v6.3 stack extends the same persistent-Agent contract with Perp Wars: OKX Demo Trading execution, a Three.js Market Citadel, domain-specific Market Intelligence progression, optional X Layer battle receipts and OKX.AI service surfaces. The supported exchange-execution profile remains one controlled Node instance and is deliberately fail-closed.

Mass-scale or mainnet launch additionally requires a transactional database, account authentication, shared rate limits, an indexer for authorized external receipts, independent smart-contract/security review, load/abuse testing and a reviewed multisig/timelock ownership policy.

