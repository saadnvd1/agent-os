/**
 * Secret shapes, and the machine details a public repo must not carry, in
 * every tracked text file. A hit names the file, line and kind and keeps
 * only a redacted stub of the value: the summary must never spread what it
 * found.
 */

import type { SourceFile } from "./source";

export interface SecretHit {
  where: string;
  kind: string;
  redacted: string;
}

const PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "private-key", re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g },
  { kind: "aws-access-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    kind: "github-token",
    re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g,
  },
  { kind: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: "openai-key", re: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/g },
  { kind: "slack-token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { kind: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "stripe-key", re: /\b[rs]k_live_[0-9A-Za-z]{20,}\b/g },
  {
    kind: "jwt",
    re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
  {
    kind: "assigned-secret",
    re: /\b(?:api[_-]?key|secret|token|password|passwd)\b["']?\s*[:=]\s*["'][A-Za-z0-9+/_.=-]{24,}["']/gi,
  },
];

// The repo is public: a home directory, a tailnet address or a MagicDNS
// name says whose machine and network it came from.
const MACHINE: { kind: string; re: RegExp }[] = [
  {
    kind: "home-path",
    re: /\/(?:Users|home)\/(?!runner\b|user\b|me\b|you\b|example\b|alice\b|bob\b)[a-z][\w.-]{1,30}\//g,
  },
  {
    kind: "tailnet-ip",
    re: /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/g,
  },
  { kind: "tailnet-name", re: /\b[\w-]+\.tail[0-9a-f]{4,}\.ts\.net\b/g },
];

const SKIP =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$|\.(png|jpe?g|gif|ico|webp|woff2?|ttf|pdf|zip|gz)$/;

export function redact(value: string): string {
  if (value.length <= 8) return "…";
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

/** The same text with every secret shape and machine detail cut to its stub. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const { re } of [...PATTERNS, ...MACHINE]) out = out.replace(re, redact);
  return out;
}

function scan(
  files: SourceFile[],
  patterns: { kind: string; re: RegExp }[]
): SecretHit[] {
  const out: SecretHit[] = [];
  for (const file of files) {
    if (SKIP.test(file.path)) continue;
    const lines = file.text.split("\n");
    lines.forEach((line, i) => {
      if (line.length > 2000) return;
      for (const { kind, re } of patterns) {
        re.lastIndex = 0;
        for (const m of line.matchAll(re))
          out.push({
            where: `${file.path}:${i + 1}`,
            kind,
            redacted: redact(m[0]),
          });
      }
    });
  }
  return out;
}

export function secretScan(files: SourceFile[]) {
  return {
    secrets: scan(files, PATTERNS),
    machineDetails: scan(files, MACHINE),
  };
}
