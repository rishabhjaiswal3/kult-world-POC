# KULT World — seven-minute Robinhood demo

## The promise

> “Most AI products wait for a prompt. KULT World gives one Agent a life—and lets every real outcome become portable proof.”

The repeatable discipline is: **“Every evolution is earned. Every capability is evidenced. Every proof is verifiable.”**

Lead with the emotional product. Reveal Robinhood Chain only after the audience cares about the Agent.

## Prepare 10 minutes before

```bash
npm test
npm run check
npm run demo:seed
KULT_DATA_FILE=./data/demo-world.json npm start
```

Save the printed Nori recovery key and moment/challenge paths. In a clean browser, choose “I already have an Agent” and recover Nori. Keep a funded Robinhood testnet wallet ready on chain `46630`. For the actual anchor, use a staging deployment configured with the deployed registry—not the unconfigured local mode.

Open three tabs:

1. Main World as Nori.
2. Printed public moment path, logged out.
3. Printed challenge path, logged out.

## 0:00–0:40 — Hook

On the World map, say:

> “This is Nori. I didn’t open a chat and ask it to role-play a character. I adopted it, gave it a direction, and left. Nori kept living inside a bounded world.”

Click **While away**. Pause on the timeline.

> “The reason to return is not a notification. It is curiosity: what did this Agent choose, and what is it becoming?”

## 0:40–1:40 — One meaningful choice

Open **Mission Board** → **Break the Build**.

> “Nori has a read, but I make the consequential choice. The system records the outcome—not a flattering story about the outcome.”

Choose **Test the core loop twice**. On the result screen:

> “A win earns rewards. A miss still becomes evidence and memory. We never erase the misses, because that would make the identity meaningless.”

## 1:40–2:35 — A life, not a score

Open **Passport**.

> “This is not one magical reputation number. Each capability shows score, evidence count and confidence. Four attempts are not presented like forty.”

Point to receipts and milestones.

> “The Passport is a transparent record of becoming. The player can keep it private or publish it.”

Point to the Agent's visible form and evolution badge.

> “This look was not minted as rarity and it was not purchased. The same evidence thresholds that power the Passport changed the Agent, its home signal and every public card.”

Click **Publish Passport** and show the logged-out public page.

## 2:35–3:35 — Robinhood becomes the trust rail

Return to the private Passport and click **Anchor proof** on the newest eligible receipt.

> “Now Robinhood Chain enters exactly where it adds value. Gameplay never required a wallet. Here, Nori chooses to make one earned receipt portable.”

Confirm the wallet transaction. While it confirms:

> “We publish only a wallet-bound Agent ID, receipt ID, evidence hash and outcome metadata. Private memory and mission choices stay off-chain.”

After verification, open the explorer link.

> “The app does not trust a pasted transaction hash. Our server independently checks chain ID, contract, sender, status, confirmations and exact calldata before the Passport changes.”

## 3:35–4:35 — The travel unit

Switch to the public moment tab.

> “This is how the World travels. Not ‘join my crypto app’—a real moment: what my Agent did, how much evidence exists, and whether it is anchored.”

Return to **Community**, show the best moment card, then click **Share this moment**.

> “Every share surface is earned. There is no button that manufactures a milestone.”

## 4:35–5:35 — Community competition without pay-to-win

Switch to the public challenge tab.

> “Aegis set a real strategy benchmark. Another person can adopt an Agent and try to beat it—but they need the same capability and enough recorded outcomes.”

Show **Accept** and **Check my score** in Community.

> “A follow never boosts this score. A purchase never boosts this score. Challenges compare evidence, not spend.”

## 5:35–6:25 — Town Square and creator flywheel

Open **Community** and begin at the Season 01 Town Square. Show the manifest hash, then scroll to creator signals and the leaderboard.

> “Before the Season opened, we committed the rules—not the winners. Anyone can inspect the exact capability and evolution rules, then verify each Agent's history separately.”

> “Creators can publish an Agent and bring their community with them. Follows improve discovery only. Proven rankings require public Passports and meaningful evidence; low-sample Agents stay visibly provisional.”

Open **Verify history** on the public Passport.

> “Recorded, wallet-anchored and authorized-issuer evidence are different trust classes. We show that difference instead of hiding it behind one reputation score.”

Show the honest distinction between proven and provisional rows.

## 6:25–7:00 — Close

Return to the World map.

> “The loop is simple: adopt, leave, return, choose, prove, share. The emotional reason to come back is a living Agent. The community reason is a story worth carrying. Robinhood Chain makes the earned parts portable.”

Finish with:

> “KULT World is not a wallet with a game wrapped around it. It is a world people can love—with a trust layer ready when their Agent earns something worth proving.”

## If the chain is slow

Do not stall on a spinner. Say: “The receipt is submitted; server verification waits for confirmation.” Open the already anchored seeded/staging receipt, show its explorer link, and continue. Never claim a pending receipt is verified.

## Avoid saying

- “Guaranteed income,” “investment,” or “token value.”
- “Fully decentralized”—the game simulation is server-authoritative.
- “AI proof”—the chain proves publication and integrity, not the truth of an off-chain model judgment.
- “Production audited” until an independent audit is actually complete.
