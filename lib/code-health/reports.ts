/**
 * Collectors that boil a tool's JSON down to what an audit reads: npm audit
 * and outdated, ESLint, a vitest JSON run, and Next.js's route bundle stats.
 */

export interface NpmAuditSummary {
  counts: Record<string, number>;
  /** high and critical only, the rest are counted. */
  serious: {
    name: string;
    severity: string;
    direct: boolean;
    via: string[];
    fix: string;
  }[];
}

interface NpmVuln {
  severity?: string;
  isDirect?: boolean;
  via?: (string | { title?: string; source?: number })[];
  fixAvailable?:
    boolean | { name?: string; version?: string; isSemVerMajor?: boolean };
}

interface PnpmAdvisory {
  module_name?: string;
  title?: string;
  severity?: string;
  patched_versions?: string | null;
  findings?: { paths?: string[] }[];
}

// pnpm audit lists advisories, not packages: one npm-style entry per module.
function fromAdvisories(
  advisories: Record<string, PnpmAdvisory>
): Record<string, NpmVuln> {
  const out: Record<string, NpmVuln> = {};
  for (const a of Object.values(advisories)) {
    const name = a.module_name ?? "";
    if (!name) continue;
    const paths = (a.findings ?? []).flatMap((f) => f.paths ?? []);
    const prev = out[name];
    const rank = (v?: string) => (v === "critical" ? 2 : v === "high" ? 1 : 0);
    out[name] = {
      severity:
        rank(a.severity) >= rank(prev?.severity) ? a.severity : prev?.severity,
      isDirect:
        Boolean(prev?.isDirect) || paths.some((p) => /^\.>[^>]+$/.test(p)),
      via: [...(prev?.via ?? []), a.title ?? ""],
      fixAvailable: a.patched_versions
        ? { name, version: a.patched_versions }
        : false,
    };
  }
  return out;
}

export function summarizeNpmAudit(json: unknown): NpmAuditSummary {
  const data = (json ?? {}) as {
    metadata?: { vulnerabilities?: Record<string, number> };
    vulnerabilities?: Record<string, NpmVuln>;
    advisories?: Record<string, PnpmAdvisory>;
  };
  const counts = { ...(data.metadata?.vulnerabilities ?? {}) };
  const vulnerabilities = data.advisories
    ? fromAdvisories(data.advisories)
    : (data.vulnerabilities ?? {});
  const serious = Object.entries(vulnerabilities)
    .filter(([, v]) => v.severity === "high" || v.severity === "critical")
    .map(([name, v]) => {
      const fix = v.fixAvailable;
      return {
        name,
        severity: v.severity ?? "",
        direct: Boolean(v.isDirect),
        via: (v.via ?? [])
          .map((x) => (typeof x === "string" ? x : (x.title ?? "")))
          .filter(Boolean)
          .slice(0, 3),
        fix:
          fix === true
            ? "npm audit fix"
            : fix && typeof fix === "object"
              ? `${fix.name}@${fix.version}${fix.isSemVerMajor ? " (major)" : ""}`
              : "none",
      };
    })
    .sort(
      (a, b) =>
        Number(b.severity === "critical") - Number(a.severity === "critical") ||
        a.name.localeCompare(b.name)
    );
  return { counts, serious };
}

export interface Outdated {
  name: string;
  current: string;
  wanted: string;
  latest: string;
  majorBehind: boolean;
}

const major = (v?: string) => Number(String(v ?? "").split(".")[0]);

export function summarizeOutdated(json: unknown): Outdated[] {
  const data = (json ?? {}) as Record<
    string,
    { current?: string; wanted?: string; latest?: string }
  >;
  return Object.entries(data)
    .map(([name, v]) => ({
      name,
      current: v.current ?? "missing",
      wanted: v.wanted ?? "",
      latest: v.latest ?? "",
      majorBehind: !!v.current && major(v.latest) > major(v.current),
    }))
    .sort(
      (a, b) =>
        Number(b.majorBehind) - Number(a.majorBehind) ||
        a.name.localeCompare(b.name)
    );
}

export interface LintSummary {
  errors: number;
  warnings: number;
  byRule: { rule: string; count: number }[];
  topFiles: { path: string; warnings: number; errors: number }[];
}

interface EslintFile {
  filePath: string;
  errorCount?: number;
  warningCount?: number;
  messages?: { ruleId?: string | null }[];
}

export function summarizeEslint(json: unknown, root = ""): LintSummary {
  const files = (Array.isArray(json) ? json : []) as EslintFile[];
  const rules = new Map<string, number>();
  let errors = 0;
  let warnings = 0;
  for (const f of files) {
    errors += f.errorCount ?? 0;
    warnings += f.warningCount ?? 0;
    for (const m of f.messages ?? []) {
      const rule = m.ruleId ?? "(parse)";
      rules.set(rule, (rules.get(rule) ?? 0) + 1);
    }
  }
  const rel = (p: string) =>
    root && p.startsWith(root) ? p.slice(root.length).replace(/^\//, "") : p;
  return {
    errors,
    warnings,
    byRule: [...rules]
      .map(([rule, count]) => ({ rule, count }))
      .sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule)),
    topFiles: files
      .filter((f) => (f.warningCount ?? 0) + (f.errorCount ?? 0) > 0)
      .map((f) => ({
        path: rel(f.filePath),
        warnings: f.warningCount ?? 0,
        errors: f.errorCount ?? 0,
      }))
      .sort(
        (a, b) =>
          b.errors + b.warnings - (a.errors + a.warnings) ||
          a.path.localeCompare(b.path)
      )
      .slice(0, 15),
  };
}

export interface SlowTests {
  totalMs: number;
  files: { path: string; ms: number; tests: number }[];
  tests: { name: string; path: string; ms: number }[];
}

interface VitestFile {
  name?: string;
  startTime?: number;
  endTime?: number;
  assertionResults?: {
    fullName?: string;
    title?: string;
    duration?: number | null;
  }[];
}

/** From `vitest run --reporter=json` (jest-shaped). */
export function slowTests(json: unknown, root = "", limit = 15): SlowTests {
  const results =
    ((json ?? {}) as { testResults?: VitestFile[] }).testResults ?? [];
  const rel = (p = "") =>
    root && p.startsWith(root) ? p.slice(root.length).replace(/^\//, "") : p;
  const files = results.map((f) => ({
    path: rel(f.name),
    ms: Math.max(0, (f.endTime ?? 0) - (f.startTime ?? 0)),
    tests: f.assertionResults?.length ?? 0,
  }));
  const tests = results.flatMap((f) =>
    (f.assertionResults ?? []).map((t) => ({
      name: t.fullName ?? t.title ?? "",
      path: rel(f.name),
      ms: Math.round(t.duration ?? 0),
    }))
  );
  return {
    totalMs: files.reduce((s, f) => s + f.ms, 0),
    files: files.sort((a, b) => b.ms - a.ms).slice(0, limit),
    tests: tests.sort((a, b) => b.ms - a.ms).slice(0, limit),
  };
}

export interface BundleSummary {
  routes: { route: string; firstLoadKB: number; chunks: number }[];
  largestChunks: { file: string; kb: number }[];
}

const kb = (n: number) => Math.round(n / 1024);

/**
 * .next/diagnostics/route-bundle-stats.json (what scripts/check-bundle.mjs
 * budgets) plus the sizes of the static chunks.
 */
export function summarizeBundle(
  stats: unknown,
  chunks: { file: string; bytes: number }[],
  limit = 10
): BundleSummary {
  const list = (Array.isArray(stats) ? stats : []) as {
    route?: string;
    firstLoadUncompressedJsBytes?: number;
    firstLoadChunkPaths?: string[];
  }[];
  return {
    routes: list
      .filter((r) => r.route)
      .map((r) => ({
        route: r.route!,
        firstLoadKB: kb(r.firstLoadUncompressedJsBytes ?? 0),
        chunks: r.firstLoadChunkPaths?.length ?? 0,
      }))
      .sort((a, b) => b.firstLoadKB - a.firstLoadKB),
    largestChunks: [...chunks]
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, limit)
      .map((c) => ({ file: c.file, kb: kb(c.bytes) })),
  };
}
