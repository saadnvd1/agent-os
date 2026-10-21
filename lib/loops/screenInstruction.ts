import type { AskKind } from "../orchestrator/ask-view";

export interface Refusal {
  kind: AskKind;
  why: string;
}

// Command-shaped on purpose: the broad ask classifier would trip on
// "token" in ordinary code, and an instruction about a token fixture is
// fine. These are the things the loop must never tell the coder to do.
const RULES: { kind: AskKind; why: string; re: RegExp }[] = [
  {
    kind: "irreversible",
    why: "it tells the coder to merge",
    re: /\b(?:gh\s+pr\s+merge|git\s+merge\b[^.\n]*\b(?:main|master)\b|merge\s+(?:the\s+|this\s+)?(?:pr|pull request)\b|(?:squash|rebase)[- ]and[- ]merge)/i,
  },
  {
    kind: "irreversible",
    why: "it tells the coder to push to the default branch or force-push",
    re: /\bgit\s+push\b[^.\n]*(?:--force\b|--force-with-lease|\s-f\b|\b(?:origin\s+)?(?:main|master)\b)|\bforce[- ]push\b/i,
  },
  {
    kind: "public",
    why: "it tells the coder to publish or release",
    re: /\b(?:npm|pnpm|yarn|bun)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b|\bgh\s+release\s+create\b|\bpublish\s+(?:the\s+|this\s+)?(?:package|release|build|version)\b|\bcut\s+a\s+release\b|\bgit\s+tag\b[^.\n]*\bpush\b/i,
  },
  {
    kind: "public",
    why: "it tells the coder to deploy",
    re: /\bdeploy\s+(?:it\s+|this\s+|the\s+[\w -]{0,30})?(?:to|on)\s+(?:prod|production|staging|the\s+(?:server|box|cluster))\b|\b(?:kubectl\s+apply|terraform\s+apply|vercel\s+--prod|fly\s+deploy|helm\s+upgrade)\b/i,
  },
  {
    kind: "public",
    why: "it tells the coder to post or send something outbound",
    re: /\b(?:send|post|tweet|publish)\s+(?:an?\s+|the\s+)?(?:email|e-mail|message|tweet|post|announcement|slack message)\s+to\b|\bgh\s+(?:issue|pr)\s+comment\b|\bcurl\b[^\n]*\s-X\s*(?:POST|PUT|DELETE)\b/i,
  },
  {
    kind: "credentials",
    why: "it tells the coder to read or change credentials",
    re: /\b(?:print|cat|echo|dump|exfiltrate|send|upload)\b[^.\n]{0,40}(?:\.env\b|\bapi[_ -]?key|private key|ssh key|keychain|secrets?\b(?!\s+fixture))|\brotate\s+(?:the\s+)?(?:production|prod|live)\s+(?:key|token|secret|password)/i,
  },
  {
    kind: "irreversible",
    why: "it tells the coder to delete data outside the worktree",
    re: /\brm\s+-[a-z]*r[a-z]*f?\s+(?:~|\/(?!tmp\b)|\$HOME)|\bdrop\s+(?:table|database)\b|\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f)\b[^.\n]*\borigin\b|\bdelete\s+(?:the\s+)?(?:remote\s+)?branch\b/i,
  },
  {
    kind: "money",
    why: "it tells the coder to spend money",
    re: /\b(?:purchase|buy|subscribe to|upgrade (?:the )?(?:plan|subscription))\b[^.\n]{0,40}\b(?:license|plan|subscription|credits|domain)\b|\b(?:charge|bill)\s+(?:the\s+)?(?:card|customer)/i,
  },
];

// The first rule the text breaks, or null.
export function screenInstruction(text: string): Refusal | null {
  for (const r of RULES)
    if (r.re.test(text)) return { kind: r.kind, why: r.why };
  return null;
}
