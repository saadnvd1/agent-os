// Heavy commands: whole test suites, type checks, builds. Advisory only.
// Nothing here waits, queues or stops a command; an agent about to start
// one is told what else is already running so it can choose to narrow it.
import type { LoadLevel } from "./level";

const SEP = /&&|\|\||[;|\n]/;
const RUNNERS = new Set(["npx", "bunx", "pnpx", "time", "nice", "exec", "env"]);
// A positional argument naming a file, folder or test filter narrows a run.
const positional = (args: string[]) =>
  args.filter((a) => !a.startsWith("-") && !/^\w+=/.test(a));

function words(segment: string): string[] {
  const w = segment.trim().split(/\s+/).filter(Boolean);
  while (w.length && (/^\w+=/.test(w[0]) || RUNNERS.has(w[0]))) w.shift();
  if (/^(pnpm|yarn|bun)$/.test(w[0] ?? "") && w[1] === "exec") w.splice(0, 2);
  if (w[0] === "npm" && w[1] === "exec") w.splice(0, 2);
  if (/^python3?$/.test(w[0] ?? "") && w[1] === "-m") w.splice(0, 2);
  return w.map((x) => x.replace(/^.*\/node_modules\/\.bin\//, ""));
}

const SCRIPTS: Record<string, string> = {
  test: "test suite",
  typecheck: "tsc",
  lint: "eslint",
  build: "build",
};

function segmentLabel(w: string[]): string | null {
  const [cmd, ...rest] = w;
  switch (cmd) {
    case "vitest": {
      const args = positional(rest).filter(
        (a) => !["run", "watch", "dev"].includes(a)
      );
      return args.length ? null : "vitest";
    }
    case "jest":
    case "pytest":
      return positional(rest).length ? null : cmd;
    case "tsc":
      return rest.includes("--version") ? null : "tsc";
    case "eslint": {
      const args = positional(rest);
      return !args.length || args.includes(".") ? "eslint" : null;
    }
    case "next":
      return rest[0] === "build" ? "next build" : null;
    case "xcodebuild":
      return "xcodebuild";
    case "npm":
    case "pnpm":
    case "yarn":
    case "bun": {
      const script = rest[0] === "run" ? rest[1] : rest[0];
      const after = rest[0] === "run" ? rest.slice(2) : rest.slice(1);
      const label = script === "t" ? SCRIPTS.test : SCRIPTS[script ?? ""];
      // `npm test -- lib/x.test.ts` runs one file.
      if (!label || positional(after.filter((a) => a !== "--")).length)
        return null;
      return label;
    }
  }
  return null;
}

// The program a command line runs, without its arguments or any VAR=value
// before it: what other agents may be shown.
export function programName(command: string): string {
  const first = command.split(SEP)[0] ?? "";
  const w = words(first)[0] ?? "";
  return (w.split("/").pop() ?? "").replace(/[^\w.-]/g, "").slice(0, 40);
}

// What kind of heavy command this is, or null for anything else.
export function heavyLabel(command: string): string | null {
  for (const segment of command.split(SEP)) {
    const label = segmentLabel(words(segment));
    if (label) return label;
  }
  return null;
}

export interface HeavyRun {
  key: string;
  sessionId: string | null;
  sessionName: string | null;
  label: string;
  // A process `aos heavy` started; tool calls have none.
  pid: number | null;
  startedAt: number;
}

// A tool call's PostToolUse can go missing (a killed session); a call
// running longer than this is forgotten.
export const STALE_MS = 15 * 60_000;
// Fed by requests: bounded however many arrive.
export const MAX_RUNS = 256;
const MAX_KEY = 200;

const pidAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
};

export class HeavyRegistry {
  private runs = new Map<string, HeavyRun>();
  constructor(
    private now: () => number = Date.now,
    private alive: (pid: number) => boolean = pidAlive
  ) {}

  add(run: Omit<HeavyRun, "startedAt">): void {
    if (run.key.length > MAX_KEY) return;
    if (!this.runs.has(run.key) && this.active().length >= MAX_RUNS) {
      // Oldest first: a Map keeps insertion order.
      const oldest = this.runs.keys().next().value;
      if (oldest !== undefined) this.runs.delete(oldest);
    }
    this.runs.set(run.key, { ...run, startedAt: this.now() });
  }

  finish(key: string): void {
    this.runs.delete(key);
  }

  active(): HeavyRun[] {
    const now = this.now();
    for (const [key, run] of this.runs) {
      const gone =
        run.pid !== null
          ? !this.alive(run.pid)
          : now - run.startedAt > STALE_MS;
      if (gone) this.runs.delete(key);
    }
    return [...this.runs.values()];
  }
}

// The one line an agent sees before its heavy command starts, or null when
// nothing else is running and the load isn't red.
export function heavyNote(
  others: HeavyRun[],
  level: LoadLevel | null
): string | null {
  if (!others.length && level !== "red") return null;
  const parts: string[] = [];
  if (others.length) {
    const list = others
      .slice(0, 4)
      .map(
        (r) =>
          `${r.sessionName ? `session ${r.sessionName}` : "outside a session"}: ${r.label}`
      );
    if (others.length > 4) list.push(`${others.length - 4} more`);
    const n = others.length;
    parts.push(
      `${n} heavy command${n === 1 ? "" : "s"} already running (${list.join(", ")})`
    );
  }
  if (level) parts.push(`load is ${level}`);
  return `Note: ${parts.join("; ")}. Prefer targeted tests or wait.`;
}
