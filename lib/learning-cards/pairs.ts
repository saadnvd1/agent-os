// Zero-token extraction of correction pairs: a thing that went wrong and
// what fixed it, a few hundred characters each.

import type { Pair, SessionInput, Step } from "./types";

const SIDE = 300;
const MAX_PAIRS = 4;
const MAX_TOTAL = 6000;
const LOOKAHEAD = 6;

const clip = (s: string, n = SIDE) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

type Tool = Extract<Step, { kind: "tool" }>;

const firstWord = (c: string) => c.trim().split(/\s+/)[0] ?? "";

// Same tool, same job (the command's first word or the file), different input.
function sameJobDifferently(bad: Tool, good: Tool): boolean {
  if (bad.name !== good.name || bad.input === good.input) return false;
  if (bad.name === "Bash")
    return !!bad.command && firstWord(bad.command) === firstWord(good.command);
  return !!bad.path && bad.path === good.path;
}

const CORRECTION =
  /^\s*(?:no\b|nope\b|wrong\b|not that\b|actually\b|stop\b|don'?t\b|do not\b)|\binstead\b|\buse\b.{1,60}\bnot\b|\bthat'?s (?:wrong|not)\b/i;
const CHANGES = new Set(["Edit", "Write", "MultiEdit", "Bash"]);

function toolRetries(steps: Step[]): Pair[] {
  const out: Pair[] = [];
  const tools = steps.filter((s): s is Tool => s.kind === "tool");
  tools.forEach((bad, i) => {
    if (!bad.failed) return;
    const good = tools
      .slice(i + 1, i + 1 + LOOKAHEAD)
      .find((t) => t.ok && sameJobDifferently(bad, t));
    if (!good) return;
    out.push({
      kind: "tool-retry",
      before: clip(`${bad.name}: ${bad.input} -> ${bad.output}`),
      after: clip(`${good.name}: ${good.input}`),
    });
  });
  return out;
}

function reviewPair(input: SessionInput): Pair[] {
  const at = input.reviews.findIndex((r) => r.status === "block");
  if (at === -1) return [];
  if (!input.reviews.slice(at + 1).some((r) => r.status === "pass")) return [];
  return [
    {
      kind: "review",
      before: clip(input.reviews[at].detail || "review blocked"),
      after: "the next review passed",
    },
  ];
}

function userCorrections(steps: Step[]): Pair[] {
  const out: Pair[] = [];
  const firstUser = steps.findIndex((s) => s.kind === "user");
  steps.forEach((s, i) => {
    if (s.kind !== "user" || i === firstUser || !s.byPerson) return;
    if (!CORRECTION.test(s.text)) return;
    const fix = steps
      .slice(i + 1)
      .find((n): n is Tool => n.kind === "tool" && n.ok && CHANGES.has(n.name));
    if (!fix) return;
    out.push({
      kind: "user-correction",
      before: clip(s.text),
      after: clip(`${fix.name}: ${fix.input}`),
    });
  });
  return out;
}

function recipePair(input: SessionInput): Pair[] {
  const { run, previousRun: prev } = input;
  if (!run || !prev || run.status !== "succeeded") return [];
  if (prev.status !== "failed" && prev.status !== "timed_out") return [];
  return [
    {
      kind: "recipe-retry",
      before: clip(prev.error || prev.summary || prev.status),
      after: clip(run.summary || "succeeded"),
    },
  ];
}

export function correctionPairs(input: SessionInput): Pair[] {
  const all = [
    ...recipePair(input),
    ...reviewPair(input),
    ...userCorrections(input.steps),
    ...toolRetries(input.steps),
  ];
  const out: Pair[] = [];
  let total = 0;
  for (const p of all) {
    const size = p.before.length + p.after.length;
    if (out.length >= MAX_PAIRS || total + size > MAX_TOTAL) break;
    total += size;
    out.push(p);
  }
  return out;
}
