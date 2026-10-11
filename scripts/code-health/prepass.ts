/**
 * The /code-health-audit skill's data tool. It measures what a script can
 * (dependencies, bundle, size, duplication, lint, route guards, shell and
 * SQL built from strings, secret shapes, slow tests) and writes a compact
 * summary to ~/.agent-os/audits/code-health; the skill reads that, not the
 * codebase. It changes nothing in the repo.
 *
 *   npx tsx scripts/code-health/prepass.ts prepass [--root .] [--next <.next dir>] [--vitest-json <file>] [--skip deps,lint,…]
 *   npx tsx scripts/code-health/prepass.ts record <audit id>
 *   npx tsx scripts/code-health/prepass.ts list
 */

import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  duplicateBlocks,
  largestFiles,
  largestFunctions,
  routeGuards,
  shellCalls,
  sqlConcat,
} from "../../lib/code-health/code";
import {
  slowTests,
  summarizeBundle,
  summarizeEslint,
  summarizeNpmAudit,
  summarizeOutdated,
} from "../../lib/code-health/reports";
import { secretScan } from "../../lib/code-health/secrets";
import {
  isCode,
  isTest,
  lineCount,
  type SourceFile,
} from "../../lib/code-health/source";
import {
  codeHealthFile,
  latestCodeHealth,
  readCodeHealthIndex,
  readPrepass,
  recordCodeHealth,
  writePrepass,
} from "../../lib/code-health/store";
import {
  compareMetrics,
  metrics,
  type CollectorRun,
  type Prepass,
} from "../../lib/code-health/summary";
import { isPublicPath } from "../../lib/security/auth";
import { auditId } from "../../lib/session-audit/store";

const COLLECTORS = [
  "deps",
  "bundle",
  "size",
  "duplicates",
  "lint",
  "routes",
  "shell",
  "sql",
  "secrets",
  "tests",
] as const;
type Collector = (typeof COLLECTORS)[number];

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

/** argv only, never a shell; a non-zero exit is data here (npm audit exits 1 on any finding). */
function run(cmd: string, argv: string[], cwd: string, timeoutMs = 180_000) {
  const r = spawnSync(cmd, argv, {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: timeoutMs,
  });
  if (r.error) throw r.error;
  return r.stdout ?? "";
}

function trackedFiles(root: string): SourceFile[] {
  const list = run("git", ["ls-files", "-z"], root).split("\0").filter(Boolean);
  const out: SourceFile[] = [];
  for (const p of list) {
    const abs = path.join(root, p);
    try {
      const stat = fs.statSync(abs);
      if (!stat.isFile() || stat.size > 1024 * 1024) continue;
      const text = fs.readFileSync(abs, "utf8");
      if (text.includes("\0")) continue;
      out.push({ path: p, text });
    } catch {
      // Deleted in the working tree: nothing to read.
    }
  }
  return out;
}

function chunkSizes(dir: string): { file: string; bytes: number }[] {
  const out: { file: string; bytes: number }[] = [];
  const visit = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) visit(p);
      else if (e.name.endsWith(".js"))
        out.push({ file: path.relative(dir, p), bytes: fs.statSync(p).size });
    }
  };
  if (fs.existsSync(dir)) visit(dir);
  return out;
}

async function prepass(args: string[]) {
  const started = Date.now();
  const root = path.resolve(flag(args, "root") ?? ".");
  const nextDir = path.resolve(root, flag(args, "next") ?? ".next");
  const vitestJson =
    flag(args, "vitest-json") ?? process.env.AGENTOS_VITEST_JSON;
  const skip = new Set((flag(args, "skip") ?? "").split(",").filter(Boolean));
  const id = flag(args, "id") ?? auditId();
  const files = trackedFiles(root);
  const code = files.filter((f) => isCode(f.path));

  const result: Prepass = {
    id,
    generatedAt: new Date().toISOString(),
    commit: run("git", ["rev-parse", "HEAD"], root).trim(),
    files: {
      code: code.filter((f) => !isTest(f.path)).length,
      tests: code.filter((f) => isTest(f.path)).length,
      lines: code.reduce((s, f) => s + lineCount(f.text), 0),
    },
    collectors: {},
  };

  const steps: Record<Collector, () => string | void> = {
    deps: () => {
      const prod = JSON.parse(
        run("npm", ["audit", "--omit=dev", "--json"], root) || "{}"
      );
      const all = JSON.parse(run("npm", ["audit", "--json"], root) || "{}");
      const outdated = JSON.parse(
        run("npm", ["outdated", "--json"], root) || "{}"
      );
      result.deps = {
        prod: summarizeNpmAudit(prod),
        all: summarizeNpmAudit(all).counts,
        outdated: summarizeOutdated(outdated),
      };
    },
    bundle: () => {
      const stats = path.join(
        nextDir,
        "diagnostics",
        "route-bundle-stats.json"
      );
      if (!fs.existsSync(stats)) return `no build stats at ${stats}`;
      result.bundle = summarizeBundle(
        JSON.parse(fs.readFileSync(stats, "utf8")),
        chunkSizes(path.join(nextDir, "static", "chunks"))
      );
    },
    size: () => {
      result.size = {
        files: largestFiles(code),
        functions: largestFunctions(code),
      };
    },
    duplicates: () => {
      result.duplicates = duplicateBlocks(code);
    },
    lint: () => {
      const out = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), "code-health-")),
        "eslint.json"
      );
      try {
        run(
          path.join(root, "node_modules", ".bin", "eslint"),
          [".", "-f", "json", "-o", out],
          root,
          600_000
        );
        result.lint = summarizeEslint(
          JSON.parse(fs.readFileSync(out, "utf8")),
          root
        );
      } finally {
        fs.rmSync(path.dirname(out), { recursive: true, force: true });
      }
    },
    routes: () => {
      result.routes = routeGuards(code, isPublicPath);
    },
    shell: () => {
      result.shell = shellCalls(code);
    },
    sql: () => {
      result.sql = sqlConcat(code);
    },
    secrets: () => {
      result.secrets = secretScan(files);
    },
    tests: () => {
      if (!vitestJson || !fs.existsSync(vitestJson))
        return "no vitest JSON (pass --vitest-json, from vitest run --reporter=json --outputFile=…)";
      result.tests = slowTests(
        JSON.parse(fs.readFileSync(vitestJson, "utf8")),
        root
      );
    },
  };

  for (const name of COLLECTORS) {
    const t = Date.now();
    let entry: CollectorRun;
    if (skip.has(name)) entry = { status: "skipped", ms: 0, note: "--skip" };
    else
      try {
        const note = steps[name]();
        entry = note
          ? { status: "skipped", ms: Date.now() - t, note }
          : { status: "ok", ms: Date.now() - t };
      } catch (error) {
        entry = {
          status: "failed",
          ms: Date.now() - t,
          note: String((error as Error).message ?? error).slice(0, 300),
        };
      }
    result.collectors[name] = entry;
  }
  writePrepass(result);

  const last = latestCodeHealth(id);
  const prev = last ? readPrepass(last.id) : null;
  console.log(
    JSON.stringify({
      id,
      commit: result.commit,
      prepass: codeHealthFile(id, ".prepass.json"),
      report: codeHealthFile(id, ".md"),
      findings: codeHealthFile(id, ".json"),
      previous: last?.id ?? null,
      previousReport: last ? codeHealthFile(last.id, ".md") : null,
      previousFindings: last ? codeHealthFile(last.id, ".json") : null,
      metrics: metrics(result),
      sinceLast: compareMetrics(
        prev ? metrics(prev) : null,
        metrics(result)
      ).filter((c) => c.change !== "same"),
      collectors: Object.fromEntries(
        Object.entries(result.collectors).map(([k, v]) => [
          k,
          v.status === "ok" ? v.ms : `${v.status}: ${v.note}`,
        ])
      ),
      ms: Date.now() - started,
    })
  );
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "prepass") return prepass(args);
  if (command === "record") {
    if (!args[0]) throw new Error("record needs the audit id");
    return console.log(JSON.stringify(recordCodeHealth(args[0])));
  }
  if (command === "list") {
    for (const e of readCodeHealthIndex())
      console.log(
        `${e.id}  ${e.commit.slice(0, 8)}  ${e.findings} findings  ${e.headline}`
      );
    return;
  }
  console.error(
    "usage: prepass.ts prepass|record|list (see the header of this file)"
  );
  process.exit(2);
}

if (process.argv[1] && /prepass\.ts$/.test(process.argv[1]))
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
