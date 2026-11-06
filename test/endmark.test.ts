import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { classify } from "../src/classify.ts";
import { buildCard, freshIntent, INTENT_TTL_MS } from "../src/card.ts";
import { append, canonical, endmarkRate, fingerprint, readAll, verify } from "../src/receipts.ts";
import { report } from "../src/report.ts";

test("read-only and workspace work pass without a card", () => {
  assert.equal(classify("read", { path: "notes.md" }).consequential, false);
  assert.equal(classify("web_search", { q: "openclaw" }).consequential, false);
  assert.equal(classify("exec", { command: "ls -la" }).consequential, false);
  assert.equal(classify("write", { path: "drafts/a.md" }).consequential, false);
  assert.equal(classify("message", { action: "react" }).consequential, false);
});

test("sends, payments, posts, deletes and pushes need a mark", () => {
  const send = classify("message", { action: "send", to: "sam@acme.com", channel: "email" }, { ownDomains: ["me.com"] });
  assert.equal(send.consequential, true);
  assert.equal(send.kind, "message-send");
  assert.equal(send.risk, "high"); // external recipient
  assert.equal(send.scope?.kind, "message-send");

  const internal = classify("message", { action: "send", to: "ana@me.com" }, { ownDomains: ["me.com"] });
  assert.equal(internal.risk, "medium");

  const pay = classify("stripe_charge", { amount: "49.99", currency: "usd", payee: "Figma" });
  assert.equal(pay.kind, "payment");
  assert.deepEqual(pay.scope, { kind: "payment", amount: "49.99", currency: "USD", target: "Figma" });

  assert.equal(classify("exec", { command: "rm -rf ~/Projects/old" }).kind, "destructive");
  assert.equal(classify("exec", { command: "git push origin main" }).kind, "code-push");
  assert.equal(classify("exec", { command: "curl -X POST https://api.x.com/v1" }).consequential, true);
  assert.equal(classify("write", { path: "/etc/hosts" }).kind, "file-write");
  assert.equal(classify("browser", { action: "click", text: "Place order" }).risk, "high");
  assert.equal(classify("some_new_plugin_tool", {}).consequential, true); // unknown is not safe
});

test("card shows what, why, checked, undo, and fits the Gateway limits", () => {
  const c = classify("message", { action: "send", to: "sam@acme.com" });
  const card = buildCard(c, { why: "Sam asked for the Friday numbers at 9:12.", checked: "Right thread, 3 rows.", at: Date.now() });
  assert.ok(card.title.startsWith("■ "));
  assert.ok(card.title.length <= 80);
  assert.ok(card.description.length <= 512);
  assert.match(card.description, /Why: Sam asked/);
  assert.match(card.description, /Checked: Right thread/);
  assert.match(card.description, /If wrong:/);
});

test("an agent that won't say why gets less trust", () => {
  const c = classify("message", { action: "send", to: "ana@me.com" }, { ownDomains: ["me.com"] });
  assert.equal(c.risk, "medium");
  const silent = buildCard(c, undefined);
  assert.equal(silent.severity, "critical");
  assert.deepEqual(silent.allowedDecisions, ["allow-once", "deny"]); // no standing yes
  assert.match(silent.description, /didn't say/);
});

test("stale intents don't carry over to a new action", () => {
  const now = Date.now();
  assert.ok(freshIntent({ why: "x", at: now - 1000 }, now));
  assert.equal(freshIntent({ why: "x", at: now - INTENT_TTL_MS - 1 }, now), undefined);
});

test("fingerprints are stable regardless of key order", () => {
  assert.equal(canonical({ b: 1, a: { d: 2, c: 3 } }), canonical({ a: { c: 3, d: 2 }, b: 1 }));
  assert.equal(fingerprint({ to: "a", amount: 1 }), fingerprint({ amount: 1, to: "a" }));
  assert.notEqual(fingerprint({ amount: 1 }), fingerprint({ amount: 10 }));
});

test("receipts chain, verify, and catch tampering", () => {
  const dir = mkdtempSync(join(tmpdir(), "endmark-"));
  const path = join(dir, "receipts.jsonl");
  const base = { tool: "message", kind: "message-send", summary: "Send a message to Sam", paramsHash: fingerprint({ to: "sam" }) };

  append(path, { ...base, type: "mark", decision: "allow-once", signer: "imessage:+15555550100", why: "Sam asked", toolCallId: "t1" });
  append(path, { ...base, type: "outcome", status: "ok", toolCallId: "t1" });
  append(path, { ...base, type: "mark", decision: "deny", signer: "imessage:+15555550100", toolCallId: "t2" });
  append(path, { ...base, type: "mark", decision: "timeout", toolCallId: "t3" });

  const all = readAll(path);
  assert.equal(verify(all).ok, true);
  assert.equal(all[1].prev, all[0].hash);

  const rate = endmarkRate(all);
  assert.deepEqual({ marked: rate.marked, total: rate.total }, { marked: 2, total: 3 }); // deny counts, timeout does not

  // Edit one receipt after the fact: the chain must say so.
  const lines = readFileSync(path, "utf8").trim().split("\n");
  const edited = JSON.parse(lines[0]);
  edited.decision = "deny";
  lines[0] = JSON.stringify(edited);
  writeFileSync(path, lines.join("\n") + "\n");
  const v = verify(readAll(path));
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 0);
  assert.match(v.reason ?? "", /edited after signing/);
});

test("/endmark report reads like a person wrote it", () => {
  const dir = mkdtempSync(join(tmpdir(), "endmark-"));
  const path = join(dir, "receipts.jsonl");
  const base = { tool: "message", kind: "message-send", summary: "Send a message to Sam", paramsHash: "h" };
  append(path, { ...base, type: "mark", decision: "allow-once", signer: "imessage:hassan", toolCallId: "t1" });
  append(path, { ...base, type: "outcome", status: "ok", toolCallId: "t1" });
  const text = report(readAll(path));
  assert.match(text, /^■ Endmark/);
  assert.match(text, /1 of 1 consequential actions had a named person decide \(100%\)/);
  assert.match(text, /Receipt chain intact/);
  assert.match(text, /approved by imessage:hassan, ran/);
  assert.ok(!text.includes("—"));
});
