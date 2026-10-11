/**
 * The pre-pass's output, the handful of numbers each run is compared on,
 * and the comparison with the run before: arithmetic a script does, so the
 * audit doesn't spend a model on it.
 */

import type {
  Duplicates,
  RouteGuards,
  ShellCall,
  Sized,
  SizedFunction,
  SqlBuild,
} from "./code";
import type {
  BundleSummary,
  LintSummary,
  NpmAuditSummary,
  Outdated,
  SlowTests,
} from "./reports";
import type { SecretHit } from "./secrets";

export interface CollectorRun {
  status: "ok" | "skipped" | "failed";
  ms: number;
  note?: string;
}

export interface Prepass {
  id: string;
  generatedAt: string;
  commit: string;
  files: { code: number; tests: number; lines: number };
  collectors: Record<string, CollectorRun>;
  deps?: {
    prod: NpmAuditSummary;
    all: NpmAuditSummary["counts"];
    outdated: Outdated[];
  };
  bundle?: BundleSummary;
  size?: {
    files: Sized[];
    functions: { min: number; count: number; top: SizedFunction[] };
  };
  duplicates?: Duplicates;
  lint?: LintSummary;
  routes?: RouteGuards;
  shell?: { risky: ShellCall[]; literal: number };
  sql?: SqlBuild[];
  secrets?: { secrets: SecretHit[]; machineDetails: SecretHit[] };
  tests?: SlowTests;
}

/** Lower is better for every metric. */
export function metrics(p: Prepass): Record<string, number> {
  const m: Record<string, number> = {};
  const set = (key: string, value: number | undefined) => {
    if (typeof value === "number" && Number.isFinite(value)) m[key] = value;
  };
  if (p.deps) {
    set(
      "prod vulns high+critical",
      (p.deps.prod.counts.high ?? 0) + (p.deps.prod.counts.critical ?? 0)
    );
    set("all vulns", p.deps.all.total);
    set(
      "deps a major behind",
      p.deps.outdated.filter((o) => o.majorBehind).length
    );
  }
  if (p.bundle)
    for (const r of p.bundle.routes)
      set(`first-load KB ${r.route}`, r.firstLoadKB);
  if (p.size) {
    set("largest file lines", p.size.files[0]?.lines);
    set(`functions over ${p.size.functions.min} lines`, p.size.functions.count);
  }
  if (p.duplicates) set("duplicated lines", p.duplicates.duplicatedLines);
  if (p.lint) {
    set("lint errors", p.lint.errors);
    set("lint warnings", p.lint.warnings);
  }
  if (p.routes) {
    set("public routes", p.routes.public.length);
    set(
      "writes with no extra guard",
      Object.values(p.routes.unguardedWrites).reduce((s, l) => s + l.length, 0)
    );
  }
  if (p.shell)
    set("shell-parsed commands built from strings", p.shell.risky.length);
  if (p.sql)
    set(
      "SQL built from strings (not placeholders)",
      p.sql.filter((s) => !s.placeholdersOnly).length
    );
  if (p.secrets) {
    set("secret-shaped strings", p.secrets.secrets.length);
    set("machine details", p.secrets.machineDetails.length);
  }
  if (p.tests) set("test time ms", p.tests.totalMs);
  return m;
}

export interface MetricChange {
  metric: string;
  before: number | null;
  after: number | null;
  change: "better" | "worse" | "same" | "new" | "gone";
}

export function compareMetrics(
  before: Record<string, number> | null,
  after: Record<string, number>
): MetricChange[] {
  if (!before) return [];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys.map((metric) => {
    const b = metric in before ? before[metric] : null;
    const a = metric in after ? after[metric] : null;
    const change: MetricChange["change"] =
      b === null
        ? "new"
        : a === null
          ? "gone"
          : a < b
            ? "better"
            : a > b
              ? "worse"
              : "same";
    return { metric, before: b, after: a, change };
  });
}
