// Append-only, hash-chained receipts. Each line links to the one before it,
// so a deleted or edited receipt shows up as a broken chain.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export type Decision = "allow-once" | "allow-always" | "deny" | "timeout" | "cancelled";

export interface ReceiptInput {
  type: "mark" | "outcome";
  tool: string;
  kind: string;
  summary: string;
  decision?: Decision; // marks only
  signer?: string; // who decided, e.g. "imessage:+1737..." or "slack:U123"
  why?: string;
  paramsHash: string; // fingerprint of the exact parameters that were approved
  toolCallId?: string;
  sessionKey?: string;
  status?: "ok" | "error" | "unknown"; // outcomes only
  durationMs?: number;
}

export interface Receipt extends ReceiptInput {
  v: 1;
  id: string;
  ts: string;
  prev: string;
  hash: string;
}

const GENESIS = "0".repeat(64);

// Stable JSON: sorted keys at every level, so the same params always hash the same.
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(obj[k]))
      .join(",") +
    "}"
  );
}

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

export function fingerprint(params: unknown): string {
  return sha256(canonical(params));
}

function hashOf(r: Omit<Receipt, "hash">): string {
  return sha256(canonical(r));
}

export function defaultStorePath(): string {
  const base = process.env.ENDMARK_DIR || join(process.env.OPENCLAW_STATE_DIR || join(homedir(), ".openclaw"), "endmark");
  return join(base, "receipts.jsonl");
}

export function readAll(path: string): Receipt[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Receipt);
}

export function makeReceipt(input: ReceiptInput, prev: string, now = new Date()): Receipt {
  const base: Omit<Receipt, "hash"> = {
    v: 1,
    id: "em_" + sha256(prev + now.toISOString() + input.paramsHash).slice(0, 12),
    ts: now.toISOString(),
    prev,
    ...input,
  };
  return { ...base, hash: hashOf(base) };
}

export function append(path: string, input: ReceiptInput, now = new Date()): Receipt {
  mkdirSync(dirname(path), { recursive: true });
  const all = readAll(path);
  const prev = all.length ? all[all.length - 1].hash : GENESIS;
  const r = makeReceipt(input, prev, now);
  appendFileSync(path, JSON.stringify(r) + "\n", { mode: 0o600 });
  return r;
}

export interface Verification {
  ok: boolean;
  count: number;
  brokenAt?: number; // index of the first bad receipt
  reason?: string;
}

export function verify(receipts: Receipt[]): Verification {
  let prev = GENESIS;
  for (let i = 0; i < receipts.length; i++) {
    const { hash, ...rest } = receipts[i];
    if (rest.prev !== prev) return { ok: false, count: receipts.length, brokenAt: i, reason: "link to previous receipt is broken" };
    if (hashOf(rest) !== hash) return { ok: false, count: receipts.length, brokenAt: i, reason: "receipt was edited after signing" };
    prev = hash;
  }
  return { ok: true, count: receipts.length };
}

// Endmark rate: share of consequential actions where a named person decided.
// A deny counts. A person decided. A timeout or a missing approval route does not.
export function endmarkRate(receipts: Receipt[]): { marked: number; total: number; rate: number } {
  const marks = receipts.filter((r) => r.type === "mark");
  const marked = marks.filter((r) => (r.decision === "allow-once" || r.decision === "allow-always" || r.decision === "deny") && !!r.signer).length;
  return { marked, total: marks.length, rate: marks.length ? marked / marks.length : 1 };
}
