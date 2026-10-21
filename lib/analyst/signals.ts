import type { ChatItem } from "../chat/events";
import type { DigestSignals } from "./types";

type Tool = Extract<ChatItem, { kind: "tool" }>;

// A command that checks the work: tests, a build, a typecheck, a lint.
const CHECK =
  /\b(?:vitest|jest|pytest|mocha|playwright|rspec|phpunit|tsc|eslint|ruff|mypy|clippy|go\s+(?:test|vet|build)|cargo\s+(?:test|build|check)|swift\s+(?:test|build)|xcodebuild|gradle\w*\s+(?:test|build)|mvn\s+(?:test|verify)|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|typecheck|lint|check)|make\s+(?:test|check|build)|scripts\/check|rails\s+test|rake\s+test)\b/;

const WEB_TOOLS = new Set(["WebFetch", "WebSearch"]);
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
// A curl or wget to anything but this machine.
const REMOTE_FETCH =
  /\b(?:curl|wget)\b[^|;&]*\bhttps?:\/\/(?!localhost\b|127\.0\.0\.1\b|\[::1\])/;

const input = (t: Tool) =>
  (t.input && typeof t.input === "object" ? t.input : {}) as Record<
    string,
    unknown
  >;

export const commandOf = (t: Tool): string | null =>
  t.name === "Bash" && typeof input(t).command === "string"
    ? (input(t).command as string)
    : null;

export const isCheckCommand = (command: string) => CHECK.test(command);

function pathOf(t: Tool): string | null {
  if (t.diff?.path) return t.diff.path;
  if (!EDIT_TOOLS.has(t.name)) return null;
  const i = input(t);
  const p = i.file_path ?? i.notebook_path;
  return typeof p === "string" ? p : null;
}

// What the turns did, counted from their items: the same answer whatever
// the analyst writes about them.
export function turnSignals(items: ChatItem[]): DigestSignals {
  const s: DigestSignals = {
    turns: 0,
    toolCalls: 0,
    failedTools: 0,
    checks: [],
    filesChanged: [],
    durationMs: 0,
    costUsd: 0,
    interrupted: false,
    errors: 0,
    noToolTurns: 0,
    readWeb: false,
  };
  const files = new Set<string>();
  let toolsThisTurn = 0;
  for (const item of items) {
    if (item.kind === "tool") {
      s.toolCalls++;
      toolsThisTurn++;
      if (item.status === "error") s.failedTools++;
      const command = commandOf(item);
      if (command && isCheckCommand(command) && item.status !== "running")
        s.checks.push({
          command: command.trim().split("\n")[0].slice(0, 200),
          passed: item.status === "done",
        });
      if (
        WEB_TOOLS.has(item.name) ||
        item.name.startsWith("mcp__") ||
        (command && REMOTE_FETCH.test(command))
      )
        s.readWeb = true;
      const path = item.status !== "error" ? pathOf(item) : null;
      if (path) files.add(path);
    } else if (item.kind === "error") s.errors++;
    else if (item.kind === "turn_end") {
      s.turns++;
      s.durationMs += item.durationMs ?? 0;
      s.costUsd += item.costUsd ?? 0;
      if (item.interrupted) s.interrupted = true;
      if (!toolsThisTurn && !item.interrupted) s.noToolTurns++;
      toolsThisTurn = 0;
    }
  }
  s.filesChanged = [...files];
  return s;
}

// The last check of each command decides it: a test that failed and then
// passed counts as passing.
export function latestChecks(s: DigestSignals) {
  const by = new Map<string, boolean>();
  for (const c of s.checks) by.set(c.command, c.passed);
  return [...by].map(([command, passed]) => ({ command, passed }));
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// One line heading the digest, and the chips the card shows.
export function signalLine(s: DigestSignals): string {
  const checks = latestChecks(s);
  const failed = checks.filter((c) => !c.passed);
  const parts = [
    plural(s.toolCalls, "tool call"),
    s.failedTools ? `${s.failedTools} failed` : "",
    checks.length
      ? failed.length
        ? `checks FAILED (${failed.map((c) => c.command).join("; ")})`
        : `checks passed (${checks.length})`
      : "no checks run",
    s.filesChanged.length
      ? plural(s.filesChanged.length, "file") + " changed"
      : "",
    s.noToolTurns ? `${plural(s.noToolTurns, "turn")} with no tool calls` : "",
    s.interrupted ? "stopped by the user" : "",
    s.errors ? plural(s.errors, "error") : "",
    s.readWeb ? "read web content" : "",
    s.durationMs ? `${Math.round(s.durationMs / 1000)}s` : "",
    s.costUsd ? `$${s.costUsd.toFixed(2)}` : "",
  ];
  return parts.filter(Boolean).join(" · ");
}
