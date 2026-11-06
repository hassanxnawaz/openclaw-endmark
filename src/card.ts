// Turns a classified tool call into the approval card a person reads.
// The Gateway caps title at 80 chars and description at 512.

import type { Classification, Risk } from "./classify.ts";

export interface Intent {
  why: string; // the agent's reason, in its own words
  checked?: string; // what it verified before asking
  at: number; // ms timestamp
}

export interface Card {
  title: string;
  description: string;
  severity: "info" | "warning" | "critical";
  allowedDecisions: Array<"allow-once" | "allow-always" | "deny">;
}

const MARK = "■";
const TITLE_MAX = 80;
const DESC_MAX = 512;

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// An intent older than this belongs to a different action.
export const INTENT_TTL_MS = 2 * 60_000;

export function freshIntent(intent: Intent | undefined, now: number): Intent | undefined {
  return intent && now - intent.at <= INTENT_TTL_MS ? intent : undefined;
}

function bump(risk: Risk): Risk {
  return risk === "low" ? "medium" : "high";
}

export function buildCard(c: Classification, intent: Intent | undefined): Card {
  // An agent that won't say why gets less trust, not more.
  const risk = intent ? c.risk : bump(c.risk);

  const lines = [
    `What: ${c.summary}`,
    intent ? `Why: ${intent.why}` : "Why: the agent didn't say. Ask before you approve.",
    `Checked: ${intent?.checked?.trim() || "nothing stated"}`,
    `If wrong: ${c.undo}`,
    "Your decision is signed with your name and kept as a receipt.",
  ];

  return {
    title: clip(`${MARK} ${c.summary}`, TITLE_MAX),
    description: clip(lines.join("\n"), DESC_MAX),
    severity: risk === "high" ? "critical" : risk === "medium" ? "warning" : "info",
    // Never offer a standing yes for high-risk actions. Each one gets a person.
    allowedDecisions: risk === "high" ? ["allow-once", "deny"] : ["allow-once", "allow-always", "deny"],
  };
}
