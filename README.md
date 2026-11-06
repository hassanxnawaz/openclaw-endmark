# Endmark for OpenClaw ■

**AI does the middle. A named person decides what ships.**

OpenClaw can send your messages, push your code, pay your invoices and post for you. Most of that should just happen. A few things shouldn't happen without you, and when they do happen, you should be able to prove who decided.

Endmark is an OpenClaw plugin that does three things:

1. **The agent says why.** Before a consequential action, the agent calls `endmark_declare` with one sentence on why and one note on what it checked.
2. **You get a card, not a prompt.** The action pauses on an Endmark card in iMessage, Slack, Telegram or wherever your approvals go:

   ```
   ■ Send a message to sam@acme.com
   What: Send a message to sam@acme.com
   Why: Sam asked for the Friday numbers at 9:12.
   Checked: Right thread, 3 rows, external recipient.
   If wrong: Messages can't be unsent everywhere. Follow up with a correction if needed.
   Your decision is signed with your name and kept as a receipt.
   ```

3. **Every decision becomes a receipt.** Approve or deny, Endmark writes a signed, hash-chained receipt: who decided, when, and a fingerprint of the exact parameters they saw. If a receipt is edited or deleted later, the chain breaks and `/endmark` says so.

```
/endmark

■ Endmark, Nov 5
2 of 2 consequential actions had a named person decide (100%).
Receipt chain intact (3 receipts).

8:22 PM  Send a message to sam@acme.com: approved by imessage:hassan, ran
8:22 PM  Publish code: git push origin main --force: denied by imessage:hassan
```

## What counts as consequential

| Gets a card | Passes straight through |
|---|---|
| Sending a message or email | Reading, searching, fetching |
| Payments, charges, refunds | Shell commands that don't change anything outside the session |
| Public posts and comments | Editing files inside your OpenClaw workspace |
| `rm -rf`, `git reset --hard`, dropping tables | Reactions |
| `git push`, `npm publish`, deploys | |
| Writing files outside the workspace | |
| Browser clicks on Submit, Buy, Pay, Delete | |
| Any tool Endmark doesn't recognize | |

Unknown tools get a card. Safe is something you decide, not the default.

## Design decisions

- **No reason, less trust.** If the agent skips `endmark_declare`, the card says "the agent didn't say", severity goes up, and the standing "allow always" option disappears.
- **High-risk actions never get a standing yes.** Payments, public posts, deletes, pushes and external sends only offer *approve once* or *deny*. Each one gets a person.
- **A deny is still a mark.** The Endmark rate counts any action where a named person decided, approve or deny. Timeouts and actions with no approval route don't count.
- **One reason covers one action.** A declared reason expires after two minutes or after the next gated call, so an old reason can't approve a new action.
- **Receipts stay on your machine.** `~/.openclaw/endmark/receipts.jsonl`, file mode 600. No network calls.

## Install

Requires OpenClaw 2026.10.9 or later.

```bash
git clone https://github.com/hassanxnawaz/openclaw-endmark.git
openclaw plugins install --link ./openclaw-endmark
openclaw plugins enable endmark
openclaw plugins inspect endmark --runtime
```

Make sure plugin approvals reach a surface you use. For iMessage or Slack, set `approvals.plugin` in `openclaw.json` (see OpenClaw's [plugin permission requests](https://docs.openclaw.ai/plugins/plugin-permission-requests) docs).

Optional config:

```json5
{
  plugins: {
    entries: {
      endmark: {
        enabled: true,
        config: {
          ownDomains: ["yourcompany.com"], // email to these domains counts as internal
          storePath: "~/.openclaw/endmark/receipts.jsonl"
        }
      }
    }
  }
}
```

## Test

```bash
npm test
```

Covers classification, card limits (80-character title, 512-character description), stale reasons, fingerprint stability, the receipt chain, tamper detection and the `/endmark` report. Type-checked against `openclaw` 2026.11.1.

## Why "Endmark"

Magazines end a story with a small square. Printers, potters and watchmakers signed their work. A mark at the end has always meant the same thing: this is finished, and someone stands behind it. Agents can do the middle. The end should still have a name on it.

Built by Hassan Nawaz. MIT license.
