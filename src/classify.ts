// Decides which tool calls deserve a human mark.
// Pure module: no OpenClaw imports, so it can be tested on its own.

export type ActionKind =
  | "message-send"
  | "external-post"
  | "payment"
  | "destructive"
  | "code-push"
  | "file-write"
  | "exec"
  | "routine";

export type Risk = "low" | "medium" | "high";

export type ApprovalScope =
  | {
      kind: "message-send";
      target: string;
      recipientCount: number;
      recipients?: string[];
      audience?: "internal" | "external";
    }
  | { kind: "payment"; amount: string; currency: string; target: string }
  | { kind: "external-post"; target: string; visibility: "public" | "restricted" };

export interface Classification {
  consequential: boolean;
  kind: ActionKind;
  risk: Risk;
  summary: string; // one plain line, shown as the card title
  undo: string; // what a person would do if this was wrong
  scope?: ApprovalScope;
}

type Params = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// Read-only tools never need a mark. Keeping this list explicit means an
// unknown tool falls through to the pattern checks below, not to "safe".
const READ_ONLY = new Set([
  "read",
  "web_search",
  "web_fetch",
  "session_status",
  "memory_search",
  "list",
  "grep",
  "glob",
  "image_describe",
  "endmark_declare",
]);

const DESTRUCTIVE_EXEC = [
  /\brm\s+-[a-z]*r[a-z]*f?\b/i,
  /\brm\s+-[a-z]*f[a-z]*r\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\bdrop\s+(table|database)\b/i,
  /\btruncate\s+table\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
];
const PUSH_EXEC = [/\bgit\s+push\b/i, /\bnpm\s+publish\b/i, /\bclawhub\s+(package\s+)?publish\b/i, /\bgh\s+(pr|release)\s+create\b/i];
const NETWORK_WRITE_EXEC = [/\bcurl\b[^|]*\s-X\s*(POST|PUT|PATCH|DELETE)\b/i, /\bcurl\b[^|]*\s--data\b/i, /\bcurl\b[^|]*\s-d\s/i];
const DEPLOY_EXEC = [/\b(vercel|netlify|fly|railway)\s+(deploy|--prod)\b/i, /\bkubectl\s+(apply|delete)\b/i, /\bterraform\s+(apply|destroy)\b/i];

const PAYMENT_TOOL = /(pay|payment|purchase|checkout|charge|invoice|stripe|transfer|refund)/i;
const POST_TOOL = /(tweet|post_|publish|x_post|linkedin_post|bluesky|mastodon|github_comment|create_issue)/i;
const EMAIL_TOOL = /(email|gmail|mail_send|send_mail)/i;

function messageTargets(p: Params): string[] {
  const raw = p.to ?? p.recipients ?? p.recipient ?? p.target ?? p.channel ?? p.chatId;
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  const s = str(raw);
  return s ? s.split(/[,;]\s*/).filter(Boolean) : [];
}

function isExternal(recipients: string[], ownDomains: string[]): boolean {
  if (!ownDomains.length) return recipients.some((r) => r.includes("@"));
  return recipients.some((r) => r.includes("@") && !ownDomains.some((d) => r.toLowerCase().endsWith("@" + d.toLowerCase())));
}

export interface ClassifyOptions {
  ownDomains?: string[]; // email domains that count as internal
}

export function classify(toolName: string, params: Params = {}, opts: ClassifyOptions = {}): Classification {
  const name = toolName.toLowerCase();
  const routine = (summary: string): Classification => ({ consequential: false, kind: "routine", risk: "low", summary, undo: "" });

  if (READ_ONLY.has(name)) return routine(`Read-only: ${toolName}`);

  // Chat and email sends.
  const action = str(params.action).toLowerCase();
  const isChatSend = name === "message" && (action === "" || /send|reply|thread-reply|thread-create|broadcast/.test(action));
  if (isChatSend || EMAIL_TOOL.test(name)) {
    const recipients = messageTargets(params);
    const target = EMAIL_TOOL.test(name) ? "email" : str(params.channel) || str(params.provider) || "chat";
    const external = isExternal(recipients, opts.ownDomains ?? []);
    const count = recipients.length;
    const who = recipients.length ? clip(recipients.slice(0, 3).join(", "), 60) + (recipients.length > 3 ? ` +${recipients.length - 3}` : "") : "this conversation";
    return {
      consequential: true,
      kind: "message-send",
      risk: external || count > 5 ? "high" : "medium",
      summary: `Send a message to ${who}`,
      undo: "Messages can't be unsent everywhere. Follow up with a correction if needed.",
      // Scope is display-only. Only declare it when the recipients are actually known.
      scope: count
        ? { kind: "message-send", target, recipientCount: count, recipients: recipients.slice(0, 5), audience: external ? "external" : "internal" }
        : undefined,
    };
  }
  if (name === "message" && /react/.test(action)) return routine("Add a reaction");

  // Payments.
  if (PAYMENT_TOOL.test(name)) {
    const amount = str(params.amount) || (typeof params.amount === "number" ? String(params.amount) : "unknown");
    const currency = (str(params.currency) || "USD").toUpperCase();
    const target = str(params.payee) || str(params.merchant) || str(params.to) || toolName;
    return {
      consequential: true,
      kind: "payment",
      risk: "high",
      summary: clip(`Pay ${amount} ${currency} to ${target}`, 70),
      undo: "Ask the payee for a refund or dispute the charge.",
      scope: { kind: "payment", amount: clip(amount, 40), currency: clip(currency, 12), target: clip(target, 128) },
    };
  }

  // Public posts.
  if (POST_TOOL.test(name)) {
    const target = str(params.platform) || str(params.repo) || toolName;
    return {
      consequential: true,
      kind: "external-post",
      risk: "high",
      summary: clip(`Post publicly on ${target}`, 70),
      undo: "Delete the post. Screenshots may already exist.",
      scope: { kind: "external-post", target: clip(target, 128), visibility: "public" },
    };
  }

  // Shell commands: only the ones that change the world outside the session.
  if (name === "exec" || name === "bash" || name === "shell") {
    const cmd = str(params.command) || str(params.cmd) || str(params.script);
    const short = clip(cmd.replace(/\s+/g, " ").trim(), 60);
    if (DESTRUCTIVE_EXEC.some((r) => r.test(cmd)))
      return { consequential: true, kind: "destructive", risk: "high", summary: `Delete or reset: ${short}`, undo: "Restore from backup or version history, if one exists." };
    if (PUSH_EXEC.some((r) => r.test(cmd)))
      return { consequential: true, kind: "code-push", risk: "high", summary: `Publish code: ${short}`, undo: "Revert the commit or unpublish the version." };
    if (DEPLOY_EXEC.some((r) => r.test(cmd)))
      return { consequential: true, kind: "code-push", risk: "high", summary: `Deploy: ${short}`, undo: "Roll back to the previous deploy." };
    if (NETWORK_WRITE_EXEC.some((r) => r.test(cmd)))
      return { consequential: true, kind: "exec", risk: "medium", summary: `Send data to a server: ${short}`, undo: "Depends on the server. Check what it accepted." };
    return routine(`Run: ${short}`);
  }

  // File edits are routine inside the workspace, consequential outside it.
  if (name === "write" || name === "edit" || name === "apply_patch") {
    const path = str(params.path) || str(params.file_path) || "";
    const outside = path.startsWith("/") && !/\/\.openclaw\/workspace/.test(path);
    if (outside)
      return { consequential: true, kind: "file-write", risk: "medium", summary: clip(`Change a file outside the workspace: ${path}`, 75), undo: "Restore the file from Time Machine or git." };
    return routine(`Edit workspace file ${path}`);
  }

  // Browser actions that commit something.
  if (name === "browser" || name.startsWith("browser_")) {
    const act = (str(params.action) + " " + str(params.text) + " " + str(params.selector)).toLowerCase();
    if (/(submit|purchase|buy|place order|checkout|pay|send|publish|delete|confirm)/.test(act))
      return { consequential: true, kind: "exec", risk: "high", summary: clip(`Click a commit button in the browser: ${act.trim()}`, 75), undo: "Depends on the site. Most orders can be cancelled right away." };
    return routine("Browse");
  }

  // Unknown tools from other plugins: mark them once, at medium risk.
  return {
    consequential: true,
    kind: "exec",
    risk: "medium",
    summary: clip(`Use ${toolName}`, 70),
    undo: "Check what the tool changed and reverse it there.",
  };
}
