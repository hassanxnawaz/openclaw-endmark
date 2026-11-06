// Endmark for OpenClaw.
// AI does the middle. A named person decides what ships.
//
// 1. The agent states why before it acts (endmark_declare).
// 2. Consequential tool calls pause on an Endmark card: what, why, what was checked, how to undo.
// 3. Every decision becomes a signed, hash-chained receipt.
// 4. /endmark shows today's receipts, the Endmark rate, and whether the chain is intact.

import { Type } from "typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { classify } from "./classify.ts";
import { buildCard, freshIntent, type Intent } from "./card.ts";
import { append, defaultStorePath, fingerprint, readAll, type Decision } from "./receipts.ts";
import { report } from "./report.ts";

type AnyCtx = Record<string, any>;

// Intents live only until the next consequential call or two minutes, whichever comes first.
const intents = new Map<string, Intent>();
const keyOf = (ctx: AnyCtx | undefined): string => String(ctx?.sessionKey ?? ctx?.sessionId ?? "global");

function signerOf(ctx: AnyCtx | undefined): string | undefined {
  const r = ctx?.requester;
  if (!r) return undefined;
  const id = r.senderId ?? r.accountId;
  if (!id) return undefined;
  return r.channel ? `${r.channel}:${id}` : String(id);
}

export default definePluginEntry({
  id: "endmark",
  name: "Endmark",
  description: "AI does the middle. A named person decides what ships. Approval cards with signed receipts.",
  register(api) {
    const cfg: AnyCtx = api.pluginConfig ?? api.config ?? {};
    const storePath: string = cfg.storePath || defaultStorePath();
    const ownDomains: string[] = Array.isArray(cfg.ownDomains) ? cfg.ownDomains : [];

    // The agent says why, in one line, before it does something that matters.
    api.registerTool(
      (toolCtx: AnyCtx) => ({
        name: "endmark_declare",
        label: "Endmark: say why",
        description:
          "Before any action that sends, posts, pays, deletes, publishes, or deploys, state in one plain sentence why you are doing it and what you checked. The person approving will see it.",
        parameters: Type.Object({
          why: Type.String({ description: "One sentence: the reason for the next action, in plain words." }),
          checked: Type.Optional(Type.String({ description: "What you verified first (recipient, amount, file, branch)." })),
        }),
        async execute(_id: string, params: { why: string; checked?: string }) {
          intents.set(keyOf(toolCtx), { why: params.why.trim().slice(0, 200), checked: params.checked?.trim().slice(0, 160), at: Date.now() });
          return { content: [{ type: "text", text: "Noted. The approval card will show this." }], details: { declared: true } };
        },
      }),
      {
        name: "endmark_declare",
        workspaceAccess: false,
        // When to call it is taught by skills/endmark/SKILL.md, bundled with this plugin.
      },
    );

    // The gate.
    api.on(
      "before_tool_call",
      (event: AnyCtx, ctx: AnyCtx) => {
        if (event.toolName === "endmark_declare") return;
        const c = classify(String(event.toolName), event.params ?? {}, { ownDomains });
        if (!c.consequential) return;

        const key = keyOf(ctx);
        const intent = freshIntent(intents.get(key), Date.now());
        intents.delete(key); // one intent covers one action
        const card = buildCard(c, intent);
        const paramsHash = fingerprint({ tool: event.toolName, params: event.params ?? {} });

        return {
          requireApproval: {
            title: card.title,
            description: card.description,
            severity: card.severity,
            allowedDecisions: card.allowedDecisions,
            scope: c.scope,
            timeoutMs: 300_000,
            onResolution(decision: Decision) {
              append(storePath, {
                type: "mark",
                tool: String(event.toolName),
                kind: c.kind,
                summary: c.summary,
                decision,
                signer: signerOf(ctx),
                why: intent?.why,
                paramsHash,
                toolCallId: event.toolCallId,
                sessionKey: ctx?.sessionKey,
              });
            },
          },
        };
      },
      { priority: 40 },
    );

    // The outcome, linked to its mark. Observation only; it never blocks.
    api.on("after_tool_call", (event: AnyCtx) => {
      if (event.toolName === "endmark_declare" || !event.toolCallId) return;
      const c = classify(String(event.toolName), event.params ?? {}, { ownDomains });
      if (!c.consequential) return;
      append(storePath, {
        type: "outcome",
        tool: String(event.toolName),
        kind: c.kind,
        summary: c.summary,
        paramsHash: fingerprint({ tool: event.toolName, params: event.params ?? {} }),
        toolCallId: event.toolCallId,
        // No result and no error is not proof of success.
        status: event.error ? "error" : event.result !== undefined ? "ok" : "unknown",
        durationMs: event.durationMs,
      });
    });

    // /endmark: today's receipts, the rate, and the chain check.
    api.registerCommand({
      name: "endmark",
      description: "Show today's Endmark receipts, the Endmark rate, and verify the receipt chain.",
      acceptsArgs: false,
      requireAuth: true,
      handler: async () => ({ text: report(readAll(storePath)) }),
    });
  },
});
