// Plain-text report for the /endmark command. Short enough to read in iMessage.

import { endmarkRate, verify, type Receipt } from "./receipts.ts";

const DECISION_LABEL: Record<string, string> = {
  "allow-once": "approved",
  "allow-always": "approved (standing)",
  deny: "denied",
  timeout: "timed out, blocked",
  cancelled: "cancelled",
};

function time(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function report(all: Receipt[], opts: { now?: Date; limit?: number } = {}): string {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 8;
  const day = now.toISOString().slice(0, 10);
  const today = all.filter((r) => r.ts.slice(0, 10) === day);
  const marks = today.filter((r) => r.type === "mark");
  const outcomeById = new Map(today.filter((r) => r.type === "outcome" && r.toolCallId).map((r) => [r.toolCallId, r]));

  const chain = verify(all);
  const rate = endmarkRate(today);
  const pct = Math.round(rate.rate * 100);

  const head = [
    `■ Endmark, ${now.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
    rate.total ? `${rate.marked} of ${rate.total} consequential actions had a named person decide (${pct}%).` : "No consequential actions today.",
    chain.ok ? `Receipt chain intact (${chain.count} receipts).` : `Receipt chain BROKEN at #${(chain.brokenAt ?? 0) + 1}: ${chain.reason}.`,
  ];

  const rows = marks.slice(-limit).map((m) => {
    const out = m.toolCallId ? outcomeById.get(m.toolCallId) : undefined;
    const result = out ? (out.status === "ok" ? ", ran" : out.status === "error" ? ", failed" : ", result unknown") : "";
    const who = m.signer ? ` by ${m.signer}` : "";
    return `${time(m.ts)}  ${m.summary}: ${DECISION_LABEL[m.decision ?? ""] ?? m.decision}${who}${result}`;
  });

  return [...head, ...(rows.length ? ["", ...rows] : [])].join("\n");
}
