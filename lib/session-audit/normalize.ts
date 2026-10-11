/**
 * Turning one session's commands, paths and errors into keys that match the
 * same thing in another session: the audit counts repeats across sessions,
 * and two worktrees never share a path or a sha.
 */

import { redact } from "../orchestrator/untrusted";

/** Tokens a text costs, by the usual 4 characters a token. An estimate. */
export const estTokens = (chars: number) => Math.ceil(chars / 4);

const HOME = /\/(?:Users|home)\/[^/\s"']+/g;
const WORKTREE = /~\/\.agent-os\/worktrees\/[^/\s"']+/g;
const ORCH_DIR = /~\/\.agent-os\/orchestrators\/[^/\s"']+/g;
const TMP = /\/(?:private\/)?(?:var\/folders|tmp)\/[^\s"']*/g;

/** A path with the machine taken out: home is ~, a worktree is <wt>. */
export function genericPath(p: string): string {
  return p
    .replace(HOME, "~")
    .replace(WORKTREE, "<wt>")
    .replace(ORCH_DIR, "<orch>")
    .replace(TMP, "<tmp>");
}

/**
 * Session text fit to leave the extractor: the machine taken out and
 * anything credential-shaped redacted, including a bearer token or an
 * inline KEY=value that redact's line-anchored rule misses.
 */
export function scrub(text: string): string {
  return redact(genericPath(text))
    .replace(/(bearer\s+)[^\s'"]+/gi, "$1[redacted]")
    .replace(
      /(\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIALS?|AUTH)[A-Z0-9_]*=)[^\s'"]+/g,
      "$1[redacted]"
    );
}

/** A file as the repo knows it, so the same file read in two worktrees is one key. */
export function repoPath(p: string): string {
  return genericPath(p).replace(/^<wt>\//, "");
}

/** The first line of a Bash command, with what differs between runs replaced. */
export function normalizeCommand(command: string): string {
  let c = command.split("\n")[0].trim();
  // A heredoc's body is data, not the command.
  c = c.replace(/<<-?\s*['"]?(\w+)['"]?.*$/, "<<$1");
  // `cd <somewhere> &&` only says where; the rest is what ran.
  while (/^cd\s+\S+\s*(&&|;)\s*/.test(c))
    c = c.replace(/^cd\s+\S+\s*(&&|;)\s*/, "");
  c = scrub(c)
    .replace(/"(?:[^"\\]|\\.)*"/g, '"…"')
    .replace(/'(?:[^'\\]|\\.)*'/g, "'…'")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "<id>"
    )
    .replace(/\b[0-9a-f]{7,40}\b/g, (m) =>
      /\d/.test(m) && /[a-f]/.test(m) ? "<sha>" : m
    )
    .replace(/\b\d+\b/g, "N")
    .replace(/\s+/g, " ")
    .trim();
  return c.length > 140 ? `${c.slice(0, 139)}…` : c;
}

/** An error's first telling line, with paths, numbers and ids replaced. */
export function normalizeError(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) => l && !/^Exit code \d+$/.test(l) && !/^<\/?tool_use_error>$/.test(l)
    );
  const line = (lines[0] ?? "").replace(/<\/?tool_use_error>/g, "");
  const n = scrub(line)
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "<id>"
    )
    .replace(/\b[0-9a-f]{7,40}\b/g, (m) =>
      /\d/.test(m) && /[a-f]/.test(m) ? "<sha>" : m
    )
    .replace(/(~|<wt>|<tmp>|<orch>)?\/[\w./@-]+/g, "<path>")
    .replace(/\b\d+(\.\d+)?\b/g, "N")
    .replace(/\s+/g, " ");
  return n.length > 160 ? `${n.slice(0, 159)}…` : n;
}

// ---- what a command is, for the patterns the audit looks for ----

/** Ways a command costs more context than the job needed. */
export type WasteClass =
  | "cat-whole-file"
  | "wide-sed-range"
  | "unscoped-grep"
  | "full-test-suite"
  | "full-diff"
  | "ci-log"
  | "poll-wait";

/** Work that recurs across sessions and could be a script, hook or fix. */
export type ManualClass =
  | "attribution-strip"
  | "rebase"
  | "dev-cleanup"
  | "ci-failure"
  | "force-push"
  | "pr-body-edit";

// The pieces of a pipeline or chain, each with what it is piped into and
// whether it reads a pipe. Quoted text holding | ; or & is blanked first: a
// `|` inside a grep pattern doesn't split anything.
function segments(
  command: string
): { seg: string; pipedTo: string | null; piped: boolean }[] {
  const blank = (q: string) => (/[|;&]/.test(q) ? `${q[0]}…${q[0]}` : q);
  const masked = command.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, blank);
  const parts = masked.split(/(\|\||&&|;|\|)/);
  const out: { seg: string; pipedTo: string | null; piped: boolean }[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const seg = parts[i].trim();
    if (!seg) continue;
    const op = parts[i + 1];
    const next = op === "|" ? (parts[i + 2] ?? "").trim() : null;
    out.push({ seg, pipedTo: next, piped: parts[i - 1] === "|" });
  }
  return out;
}

const LIMITER =
  /^(head|tail|wc|grep|rg|sed|awk|jq|sort|uniq|cut|less|tr|xargs)\b/;

export function wasteClasses(command: string): WasteClass[] {
  const out = new Set<WasteClass>();
  const first = command.split("\n")[0];
  for (const { seg, pipedTo } of segments(first)) {
    const limited = pipedTo !== null && LIMITER.test(pipedTo);
    if (
      /^cat\s+[^<>]*\S$/.test(seg) &&
      !/^cat\s+-/.test(seg) &&
      !limited &&
      !/<</.test(seg)
    )
      out.add("cat-whole-file");
    const sed = seg.match(/^sed\s+-n\s+['"]?(\d+),(\d+)p/);
    if (sed && Number(sed[2]) - Number(sed[1]) >= 300)
      out.add("wide-sed-range");
    if (
      /^(grep\s+(-\w*[rR]\w*|--recursive)|rg)\b/.test(seg) &&
      !/\s-(\w*[lLcqm]\w*)\b|--files-with-matches|--count|--max-count|--quiet/.test(
        seg
      ) &&
      !limited
    )
      out.add("unscoped-grep");
    if (isFullSuite(seg)) out.add("full-test-suite");
    if (
      /^git\s+(diff|show|log\s+.*-p)\b/.test(seg) &&
      !/--stat|--name-only|--name-status|--shortstat|--numstat|-s\b|--quiet|--exit-code|\s--\s/.test(
        seg
      ) &&
      !limited
    )
      out.add("full-diff");
    if (/^gh\s+run\s+view\b.*--log/.test(seg) && !limited) out.add("ci-log");
    if (
      /^(sleep\s+\d|until\b|while\s+(true|:))/.test(seg) ||
      /^gh\s+(pr\s+checks\b.*--watch|run\s+watch\b)/.test(seg)
    )
      out.add("poll-wait");
  }
  return [...out];
}

// The whole suite: a runner with nothing after it naming what to run.
function isFullSuite(seg: string): boolean {
  if (/^npm\s+(test|t)\s*$/.test(seg) || /^npm\s+run\s+test\s*$/.test(seg))
    return true;
  if (/^yarn\s+test\s*$/.test(seg) || /^pnpm\s+test\s*$/.test(seg)) return true;
  const runner = seg.match(
    /^(?:npx\s+)?(vitest|jest|playwright\s+test|pytest|bundle\s+exec\s+rspec|rspec|go\s+test)\b(.*)$/
  );
  if (!runner) return false;
  const args = runner[2]
    .trim()
    .split(/\s+/)
    .filter(
      (a) => a && a !== "run" && !a.startsWith("-") && !/^(2>&1|>|>>)/.test(a)
    );
  if (runner[1] === "go test") return args.every((a) => a === "./...");
  return args.length === 0;
}

// A trailer named, and something that rewrites a commit or a PR body.
const TRAILER =
  /co-authored-by|generated with|interpret-trailers|noreply@anthropic/i;
const REWRITE =
  /--amend|\brebase\b|msg-filter|commit-tree|interpret-trailers|\bsed\b|grep\s+-v|gh\s+pr\s+edit/;

export function manualClasses(command: string): ManualClass[] {
  const out = new Set<ManualClass>();
  if (TRAILER.test(command) && REWRITE.test(command))
    out.add("attribution-strip");
  if (/\bgit\s+(filter-branch|filter-repo)\b/.test(command))
    out.add("attribution-strip");
  if (
    /\bgit\s+(rebase\b(?!\s+--(abort|continue|skip))|pull\s+--rebase)/.test(
      command
    )
  )
    out.add("rebase");
  if (
    /\btmux\b[^|;&]*\bkill-(server|session)\b|\bpkill\b|\bkillall\b|lsof\s+-ti[^|]*\|\s*xargs\s+(-\S+\s+)?kill/.test(
      command
    )
  )
    out.add("dev-cleanup");
  if (/\bgh\s+run\s+(view|rerun)\b|\bgh\s+pr\s+checks\b/.test(command))
    out.add("ci-failure");
  if (/\bgit\s+push\b[^|;&]*(\s--force(-with-lease)?\b|\s-f\b)/.test(command))
    out.add("force-push");
  if (/\bgh\s+pr\s+edit\b/.test(command)) out.add("pr-body-edit");
  return [...out];
}

/** The file a shell read targets, when it is a plain read of one file. */
export function shellReadTarget(command: string): string | null {
  const first = command.split("\n")[0];
  for (const { seg, piped } of segments(first)) {
    if (piped) continue;
    const m =
      seg.match(/^cat\s+(?!-)(\S+)$/) ||
      seg.match(/^sed\s+-n\s+['"]?\d+,\d+p['"]?\s+(\S+)$/) ||
      seg.match(/^(?:head|tail)\s+(?:-n\s*\d+\s+|-\d+\s+)?([^\s-]\S*)$/);
    if (m && !/^\d+$/.test(m[1]) && !m[1].startsWith('"'))
      return m[1].replace(/^'|'$/g, "");
  }
  return null;
}
