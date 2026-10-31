import fs from "fs";
import path from "path";
import { agentosHome } from "@/lib/agentos-home";
import type { Entry } from "./schema";

// The repo is public, so this checks only generic shapes. Names that must
// never appear (other products) live in a private list outside the repo and
// are passed in.
const GENERIC: [string, RegExp][] = [
  ["a user path", /\/Users\/|~\/|\/home\/\w|(?:^|[\s(])\.[a-z][\w-]*\//i],
  ["a file path", /\b[\w.-]+\/[\w.-]+\/[\w./-]+|\/[\w.-]+\/[\w.-]+/],
  [
    "a file name",
    /\b[\w-]+\.(?:tsx?|jsx?|mjs|json|md|sh|py|sql|ya?ml|toml)\b/i,
  ],
  ["an IP address", /\b\d{1,3}(?:\.\d{1,3}){3}\b/],
  [
    "a hostname",
    /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:ts\.net|local|internal|lan|home|com|io|net|app|dev|org|ai|co)\b/i,
  ],
  ["a token", /\b(?:gh[pousr]_|github_pat_|npm_|sk-|xox[bp]-)[\w-]{8,}/],
  ["a long secret-looking string", /\b[A-Za-z0-9_-]{32,}\b/],
  ["tailnet", /tailnet|tailscale/i],
  ["a CVE", /\bCVE-\d{4}-\d+/i],
  ["a vulnerability", /vulnerab|exploit|\bRCE\b/i],
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Why this text can't ship, or null when it can. */
export function lintText(
  text: string,
  blocklist: string[] = []
): string | null {
  for (const [what, re] of GENERIC)
    if (re.test(text)) return `contains ${what}`;
  for (const name of blocklist) {
    if (
      new RegExp(
        `(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`,
        "iu"
      ).test(text)
    )
      return "contains a blocked name";
  }
  return null;
}

export const lintEntry = (e: Entry, blocklist: string[] = []) =>
  lintText(e.text, blocklist) ?? (e.note ? lintText(e.note, blocklist) : null);

const BLOCKLIST_HEADER =
  "# One name per line (any name that must never appear in the\n# changelog). Matched whole-word, any case. Lives outside the repo on purpose.\n";

export const blocklistPath = () => agentosHome("whats-new-blocklist.txt");

/** The private list; created empty (with a comment) when it is missing. */
export function readBlocklist(file: string = blocklistPath()): string[] {
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, BLOCKLIST_HEADER);
    return [];
  }
  return fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}
