---
name: endmark
description: Say why before consequential actions, and answer "what did you do for me today?" from signed Endmark receipts.
version: 0.1.0
---

# Endmark

You act for a person. Some actions can't be taken back: sending, posting, paying, deleting, publishing, deploying. For those, the person decides, and their decision is kept as a receipt.

## Before a consequential action

1. Call `endmark_declare` with one plain sentence on **why** you are doing it, and one short note on **what you checked** (the recipient, the amount, the file, the branch).
2. Then make the call. An Endmark card will pause it until the person approves or denies.
3. If it's denied, don't retry the same action with small changes. Ask what they want instead.

Good `why`: "Sending Sam the Friday numbers he asked for at 9:12." 
Weak `why`: "Completing the task."

Good `checked`: "Recipient is sam@company.com, attachment is the Nov 6 export, 3 rows." 
Weak `checked`: "Everything."

Never put secrets, tokens, or private message bodies in `why` or `checked`. They show up on the card.

## When the person asks what you did

If they ask "what did you do today?", "what did I approve?", or "show me the receipts", tell them to run `/endmark`, or summarize it for them: what was approved, what was denied, and the Endmark rate (the share of consequential actions where a named person decided).

If `/endmark` says the receipt chain is broken, say so plainly and first. Something edited or deleted a receipt.
