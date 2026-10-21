import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { agentosHome } from "../agentos-home";
import { git } from "../git-exec";
import { adviseHeavy } from "../load/advise";
import { checkEnv } from "../orchestrator/claude-cli";
import { compactCommand, signatureOf } from "./compactEvidence";
import type { CommandResult, EvidenceSummary } from "./types";

export const EVIDENCE_TIMEOUT_MS = 10 * 60_000;
const OUTPUT_KEEP = 2_000_000;

export interface EvidenceCommands {
  typecheck: string | null;
  test: string | null;
}

const TYPECHECK = /\btypecheck\b|\btsc\b/;
const PLACEHOLDER = /<[^<>]*>/;
const TEST_FILE =
  /\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]+\.py$|_test\.(?:go|py|rb)$/;

// The yardstick is the BASE branch's agentos.json (or .dispatch.json): the
// coder can't make a check pass by editing the command that runs it.
export async function commandsFromBase(
  repo: string,
  base: string
): Promise<EvidenceCommands> {
  for (const file of ["agentos.json", ".dispatch.json"]) {
    let text: string;
    try {
      text = await git(repo, ["show", `${base}:${file}`]);
    } catch {
      continue;
    }
    try {
      const test = (JSON.parse(text) as { test?: unknown }).test;
      if (typeof test !== "string" || !test.trim()) continue;
      const parts = test
        .split("&&")
        .map((s) => s.trim())
        .filter(Boolean);
      const type = parts.filter((p) => TYPECHECK.test(p));
      const rest = parts.filter((p) => !TYPECHECK.test(p));
      return {
        typecheck: type.length ? type.join(" && ") : null,
        test: rest.length ? rest.join(" && ") : null,
      };
    } catch {
      continue;
    }
  }
  return { typecheck: null, test: null };
}

// The test files in the diff, and the ones beside changed source files.
export async function testFilesFor(
  dir: string,
  base: string,
  sha: string
): Promise<string[]> {
  const out = await git(dir, [
    "diff",
    "--name-only",
    "--no-renames",
    `${base}...${sha}`,
  ]).catch(() => "");
  const changed = out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const found = new Set<string>();
  for (const f of changed) {
    if (TEST_FILE.test(f)) {
      if (fs.existsSync(path.join(dir, f))) found.add(f);
      continue;
    }
    const ext = path.extname(f);
    const stem = f.slice(0, f.length - ext.length);
    for (const suffix of [".test", ".spec"])
      for (const e of [ext, ".ts", ".tsx"]) {
        const candidate = `${stem}${suffix}${e}`;
        if (fs.existsSync(path.join(dir, candidate))) found.add(candidate);
      }
  }
  return [...found].sort();
}

// "<the test files you touched>" and its like become the files; with none the
// command is skipped. A command with no placeholder is the whole suite.
export function fillPlaceholder(
  command: string,
  files: string[]
): { command: string | null; why?: string } {
  if (!PLACEHOLDER.test(command)) return { command };
  if (!files.length)
    return { command: null, why: "no test files in the diff to run" };
  return {
    command: command.replace(
      PLACEHOLDER,
      files.map((f) => JSON.stringify(f)).join(" ")
    ),
  };
}

export interface RunOutput {
  exitCode: number | null;
  output: string;
  durationMs: number;
}
export type Runner = (
  command: string,
  cwd: string,
  timeoutMs: number
) => Promise<RunOutput>;

export const runShell: Runner = (command, cwd, timeoutMs) =>
  new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, {
      cwd,
      shell: true,
      env: { ...checkEnv(), CI: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    if (child.pid)
      try {
        adviseHeavy({
          key: `pid:${child.pid}`,
          sessionId: null,
          label: "loop checks",
          pid: child.pid,
        });
      } catch {}
    let output = "";
    const take = (d: Buffer) => {
      output += d;
      if (output.length > OUTPUT_KEEP) output = output.slice(-OUTPUT_KEEP);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {}
      output += `\n[timed out after ${Math.round(timeoutMs / 1000)}s]`;
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, output, durationMs: Date.now() - started });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({
        exitCode: 127,
        output: String(e),
        durationMs: Date.now() - started,
      });
    });
  });

// One evidence run at a time on the machine, so loops don't stack suites.
let chain: Promise<unknown> = Promise.resolve();
const alone = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
};

export const loopLogPath = (taskId: string, n: number) =>
  agentosHome("loops", taskId, `${n}.log`);

export interface Gathered {
  summary: EvidenceSummary;
  signature: string | null;
  logPath: string | null;
}

// Typecheck, then the tests, in the task's worktree. Output goes to a log
// file; what comes back is compact.
export async function gatherEvidence(input: {
  taskId: string;
  n: number;
  dir: string;
  commands: EvidenceCommands;
  testFiles: string[];
  run?: Runner;
  timeoutMs?: number;
}): Promise<Gathered> {
  const run = input.run ?? runShell;
  const results: CommandResult[] = [];
  const outputs = new Map<string, string>();
  const log: string[] = [];
  const todo: { name: CommandResult["name"]; raw: string | null }[] = [
    { name: "typecheck", raw: input.commands.typecheck },
    { name: "test", raw: input.commands.test },
  ];
  await alone(async () => {
    for (const { name, raw } of todo) {
      if (!raw) continue;
      const filled = fillPlaceholder(raw, input.testFiles);
      if (!filled.command) {
        results.push({
          name,
          command: raw,
          exitCode: null,
          durationMs: 0,
          passed: [],
          failed: [],
          errors: [],
          excerpt: "",
          skipped: filled.why,
        });
        continue;
      }
      const r = await run(
        filled.command,
        input.dir,
        input.timeoutMs ?? EVIDENCE_TIMEOUT_MS
      );
      log.push(`$ ${filled.command}\n${r.output}\n[exit ${r.exitCode}]\n`);
      outputs.set(name, r.output);
      results.push(
        compactCommand({
          name,
          command: filled.command,
          exitCode: r.exitCode,
          durationMs: r.durationMs,
          output: r.output,
        })
      );
    }
  });
  const ran = results.filter((r) => !r.skipped);
  const green = ran.length > 0 && ran.every((r) => r.exitCode === 0);
  const note = !ran.length
    ? "no check could run: " +
      (results
        .map((r) => r.skipped)
        .filter(Boolean)
        .join("; ") || "no test command on the base branch")
    : results.some((r) => r.skipped)
      ? results
          .filter((r) => r.skipped)
          .map((r) => `${r.name} skipped: ${r.skipped}`)
          .join("; ")
      : undefined;
  let logPath: string | null = null;
  if (log.length) {
    try {
      logPath = loopLogPath(input.taskId, input.n);
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.writeFileSync(logPath, log.join("\n"));
    } catch {
      logPath = null;
    }
  }
  return {
    summary: { green, commands: results, ci: [], ...(note ? { note } : {}) },
    signature: signatureOf(results, outputs),
    logPath,
  };
}
