# KULT World v3.1 launch handoff

## Release verdict

This package is a **controlled Robinhood Chain Testnet launch candidate**, not a mainnet or mass-scale release. The player journey, public growth surfaces, server verification and deployment guardrails are complete. A production launch still requires a deployed registry address, managed RPC, HTTPS origin, persistent disk and final human QA.

## Required go-live sequence

1. Run `npm test`, `npm run test:coverage`, and `npm run check`.
2. Install Foundry and run `npm run test:contract`.
3. Deploy `KultWorldExperienceRegistry.sol` from a throwaway funded testnet deployer.
4. Verify the deployed source/bytecode and record the address.
5. Commit the exact `season.js` ID/hash and record the transaction as `KULT_SEASON_COMMIT_TX`.
6. Configure all production variables in `.env.example`; never expose the managed server RPC URL to the browser.
7. Deploy one application instance with one persistent disk.
8. Execute the full QA matrix below on staging, including all four evolution forms and dynamic OG images.
9. Back up and restore the staging data file.
10. Invite 50 internal/community testers, then expand only after 24 hours of clean telemetry.

## Human QA matrix

- Desktop: current Chrome, Firefox and Safari at 1440×900.
- Mobile: iPhone-size 390×844 and Android-size 412×915.
- Adopt every identity; verify a fresh state starts with zero public activity.
- Save a recovery key, recover in a clean browser, and confirm the old browser is revoked.
- Complete a win and a miss; confirm both appear as evidence.
- Leave long enough for one offline step and verify the recap.
- Buy one home item; confirm Credits decrease and capability does not jump.
- Publish a Passport; open it logged out and confirm private memory/wallet address are absent.
- Share an earned moment and inspect title/description metadata.
- Create a challenge; accept as a second Agent; confirm self-challenge and replay inflation fail.
- Register a creator, follow once, follow again, and confirm the count increases only once.
- Anchor a valid receipt; inspect the explorer transaction and Passport link.
- Try a successful transaction with wrong sender, target and calldata; confirm each is rejected.
- Test wallet rejection, slow confirmation, RPC outage and reverted transaction states.

## Funnel metrics

The bearer-protected `/api/admin/metrics` endpoint exposes coarse launch counters without raw owner records.

| Decision | Signal | Initial bar |
|---|---|---:|
| Onboarding clarity | Adopted / landing sessions | 60% |
| Core fun | First mission / adopted | 45% |
| Attachment | Active D1 / adopted | 35% |
| Durable value | Active D7 / adopted | 18% |
| Return comprehension | Recap opened / returned | 30% |
| Identity investment | Home personalized / adopted | 20% |
| Social expression | Public Passport / active D7 | 15% |
| Reliability | Crash-free sessions | 99% |

Wallet connection and anchoring are downstream diagnostics, not activation goals.

## Stop conditions

Pause invitations if any of these occur:

- Another browser can access an Agent without its current session or recovery key.
- A receipt is marked anchored without exact on-chain evidence verification.
- The persistent store cannot be restored cleanly.
- Error rate exceeds 1% for core adoption/mission/state routes.
- The single process approaches sustained CPU, memory or disk limits.
- Community moderation or support coverage is unavailable.

## Scale boundary

Do not add application replicas while using `JsonStore`. The next architecture milestone is transactional storage, account authentication, centralized rate limits, audit logs, backups and idempotent job processing. Contract mainnet usage also requires an independent audit and reviewed ownership policy.
