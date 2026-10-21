import { failureSignature, normalize } from "../orchestrator/loop-guard";
import { redact } from "../models/secrets";
import type { CommandResult } from "./types";

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const FAILED_TEST = /^\s*(?:FAIL\s+|[×✗]\s+|not ok \d+ - )(.+)$/;
const PASSED_TEST = /^\s*(?:[✓√]\s+|ok \d+ - |PASS\s+)(.+)$/;
// tsc: "file.ts(12,3): error TS2322: ..." or "file.ts:12:3 - error TS2322: ..."
const TS_ERROR = /^(.+?)(?:\((\d+),\d+\)|:(\d+):\d+)\s*[:-]\s*error\s+(TS\d+)/;

const MAX_TYPE_ERRORS = 30;
const EXCERPT_LINES = 30;
export const EVIDENCE_CHARS = 6000;

const clean = (s: string) => s.replace(ANSI, "");

// A passed test line carries its timing and count; the name is what a
// citation names.
const nameOf = (s: string) =>
  normalize(s)
    .replace(/\(\d+ tests?[^)]*\)/, "")
    .trim();

export function typeErrorsOf(output: string): string[] {
  const seen = new Set<string>();
  for (const line of clean(output).split("\n")) {
    const m = TS_ERROR.exec(line.trim());
    if (m) seen.add(`${m[1]}:${m[2] ?? m[3]} ${m[4]}`);
  }
  return [...seen];
}

function excerptOf(lines: string[], firstFailure: number): string {
  const at =
    firstFailure >= 0
      ? firstFailure
      : Math.max(lines.length - EXCERPT_LINES / 2, 0);
  const from = Math.max(at - 5, 0);
  return lines.slice(from, from + EXCERPT_LINES).join("\n");
}

// What one command did, in a few hundred tokens: exit code, the tests that
// passed and failed, the type errors (once each), and the lines around the
// first failure. No model.
export function compactCommand(input: {
  name: CommandResult["name"];
  command: string;
  exitCode: number | null;
  durationMs: number;
  output: string;
}): CommandResult {
  const lines = clean(input.output).split("\n");
  const passed = new Set<string>();
  const failed = new Set<string>();
  let first = -1;
  lines.forEach((l, i) => {
    const f = FAILED_TEST.exec(l)?.[1];
    if (f) {
      failed.add(nameOf(f));
      if (first < 0) first = i;
      return;
    }
    const p = PASSED_TEST.exec(l)?.[1];
    if (p) passed.add(nameOf(p));
  });
  const errors = input.name === "typecheck" ? typeErrorsOf(input.output) : [];
  if (input.name === "typecheck" && errors.length && first < 0)
    first = lines.findIndex((l) => TS_ERROR.test(l.trim()));
  if (first < 0 && input.exitCode !== 0)
    first = lines.findIndex((l) => /\berror\b|\bfail/i.test(l));
  return {
    name: input.name,
    command: input.command,
    exitCode: input.exitCode,
    durationMs: input.durationMs,
    passed: [...passed].slice(0, 400),
    failed: [...failed].slice(0, 100),
    errors: errors.slice(0, MAX_TYPE_ERRORS),
    excerpt: redact(input.exitCode === 0 ? "" : excerptOf(lines, first)),
  };
}

// The signature a repeat is judged by: the same one the merge loop guard
// uses for a failing CI log, over the failing commands' output.
export function signatureOf(
  results: CommandResult[],
  output: Map<string, string>
): string | null {
  const failing = results.filter((r) => r.exitCode !== 0 && !r.skipped);
  if (!failing.length) return null;
  const parts = failing.map(
    (r) =>
      failureSignature(r.name, output.get(r.name) ?? r.excerpt) ??
      (r.errors.length
        ? `${r.name}: ${r.errors.slice(0, 5).join("; ")}`
        : `${r.name}: exit ${r.exitCode}`)
  );
  return parts.join(" | ").slice(0, 500);
}

export function scoreOf(results: CommandResult[], met: number) {
  return {
    met,
    failingTests: results
      .filter((r) => r.name === "test")
      .reduce((n, r) => n + r.failed.length, 0),
    typeErrors: results
      .filter((r) => r.name === "typecheck")
      .reduce((n, r) => n + r.errors.length, 0),
  };
}

// The text the analyst reads, capped.
export function evidenceText(
  results: CommandResult[],
  ci: { name: string; state: string }[]
): string {
  const out: string[] = [];
  for (const r of results) {
    const head = r.skipped
      ? `${r.name}: skipped (${r.skipped})`
      : `${r.name} \`${r.command}\`: ${r.exitCode === 0 ? "passed" : `FAILED (exit ${r.exitCode})`} in ${Math.round(r.durationMs / 1000)}s`;
    out.push(head);
    if (r.passed.length)
      out.push(
        `  passed (${r.passed.length}): ${r.passed.slice(0, 40).join("; ")}`
      );
    if (r.failed.length)
      out.push(`  failed (${r.failed.length}): ${r.failed.join("; ")}`);
    if (r.errors.length)
      out.push(`  type errors (${r.errors.length}): ${r.errors.join("; ")}`);
    if (r.excerpt) out.push(`  around the first failure:\n${r.excerpt}`);
  }
  if (ci.length)
    out.push(`CI: ${ci.map((c) => `${c.name} ${c.state}`).join(", ")}`);
  const text = out.join("\n");
  return text.length > EVIDENCE_CHARS
    ? `${text.slice(0, EVIDENCE_CHARS)}\n… (cut)`
    : text;
}
