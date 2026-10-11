// Pure parsing, range and rendering logic for the competitor audit. The CLI
// in audit.ts does the git, gh and file IO; everything here is testable.

export const FIRST_RUN_DAYS = 60;

/** A competitor slug names its cache and report directories, so it must be path-safe. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
/** "owner/name" on GitHub. */
export const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export const repoUrl = (repo: string) => `https://github.com/${repo}`;

export type Area =
  | "features"
  | "ux"
  | "remote"
  | "agents"
  | "settings"
  | "perf"
  | "security"
  | "reliability"
  | "maintenance";

export const AREA_TITLES: Record<Area, string> = {
  features: "Features",
  ux: "UX (web, desktop, mobile)",
  remote: "Remote and multi-machine",
  agents: "Agents and providers",
  settings: "Settings",
  perf: "Performance",
  security: "Security",
  reliability: "Fixes and reliability",
  maintenance: "Maintenance (refactor, test, chore, ci, docs)",
};

export interface Commit {
  sha: string;
  date: string;
  author: string;
  subject: string;
  type: string;
  scope: string;
  pr: number | null;
  files: { path: string; added: number; deleted: number }[];
  size: number;
  area: Area;
}

export interface Range {
  mode: "sha" | "since";
  fromSha: string | null;
  since: string | null;
  note: string;
}

// ---- previous reports -------------------------------------------------------

const REPORT_RE = /^(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.md$/;

function reportKey(name: string): [string, number] | null {
  const m = REPORT_RE.exec(name);
  return m ? [m[1], m[2] ? Number(m[2]) : 1] : null;
}

/** Report files sorted oldest first; "2026-10-10-2.md" sorts after "2026-10-10.md". */
export function sortReports(names: string[]): string[] {
  return names
    .filter((n) => reportKey(n))
    .sort((a, b) => {
      const [da, na] = reportKey(a)!;
      const [db, nb] = reportKey(b)!;
      return da === db ? na - nb : da < db ? -1 : 1;
    });
}

/** The file name today's run writes: YYYY-MM-DD.md, or -2, -3 on a rerun. */
export function nextReportName(existing: string[], today: string): string {
  const sameDay = existing.map(reportKey).filter((k) => k && k[0] === today);
  if (sameDay.length === 0) return `${today}.md`;
  return `${today}-${Math.max(...sameDay.map((k) => k![1])) + 1}.md`;
}

export function parseFrontmatter(md: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---/.exec(md);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

/** Titles of the previous run's "Top 10" items ("### 3. Title" headings). */
export function parseTopTen(md: string): string[] {
  const start = md.search(/^## Top 10\b/m);
  if (start < 0) return [];
  const rest = md.slice(start).split("\n").slice(1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return (end < 0 ? rest : rest.slice(0, end))
    .map((l) => /^### \d+\.\s+(.*)$/.exec(l)?.[1].trim())
    .filter((t): t is string => !!t);
}

// ---- range ------------------------------------------------------------------

export function daysBefore(isoDate: string, days: number): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Which commits this run covers. The previous report's `to` sha
 * is the start when it is still an ancestor of HEAD; after a force push (or a
 * clone too shallow to hold it) fall back to the previous audit's date; with
 * no previous report, the last FIRST_RUN_DAYS days.
 */
export function resolveRange(opts: {
  prevSha?: string | null;
  prevDate?: string | null;
  today: string;
  isAncestor: (sha: string) => boolean;
}): Range {
  const { prevSha, prevDate, today, isAncestor } = opts;
  if (prevSha && isAncestor(prevSha)) {
    return {
      mode: "sha",
      fromSha: prevSha,
      since: null,
      note: `since the previous audit's commit ${prevSha.slice(0, 9)}`,
    };
  }
  if (prevSha && prevDate) {
    return {
      mode: "since",
      fromSha: null,
      since: prevDate,
      note: `previous commit ${prevSha.slice(0, 9)} is not an ancestor of HEAD (force push or shallow history), so covering commits since the previous audit date ${prevDate}`,
    };
  }
  const since = daysBefore(today, FIRST_RUN_DAYS);
  return {
    mode: "since",
    fromSha: null,
    since,
    note: `first run: no previous audit, covering the last ${FIRST_RUN_DAYS} days (since ${since})`,
  };
}

/**
 * How far back the shallow clone must reach: two weeks before the previous
 * audit (or the first run's window), so the previous sha and the range's base
 * commit are both in history.
 */
export function fetchSince(
  prevDate: string | null | undefined,
  today: string
): string {
  return daysBefore(prevDate || daysBefore(today, FIRST_RUN_DAYS), 14);
}

export function pickBiggest(commits: Commit[], n: number): Commit[] {
  return commits
    .filter(
      (c) =>
        (c.type === "feat" || c.type === "perf") && c.area !== "maintenance"
    )
    .sort((a, b) => b.size - a.size)
    .slice(0, n);
}

// ---- commits ----------------------------------------------------------------

// Lockfiles, snapshots, generated code and tests: excluded from a change's size.
const NOISE =
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|Cargo\.lock)$|\.snap$|\.gen\.\w+$|\.(test|spec)\.\w+$|(^|\/)(dist|_?generated|__tests__)\//;

export function parseConventional(subject: string): {
  type: string;
  scope: string;
  pr: number | null;
} {
  const pr = /\(#(\d+)\)\s*$/.exec(subject);
  const cc = /^(\w+)(?:\(([^)]*)\))?!?:/.exec(subject);
  return {
    type: cc ? cc[1].toLowerCase() : "other",
    scope: cc?.[2]?.toLowerCase() ?? "",
    pr: pr ? Number(pr[1]) : null,
  };
}

const RS = "\x1e";
const US = "\x1f";
export const LOG_FORMAT = `${RS}%H${US}%cI${US}%an${US}%s`;

/** Parses `git log --no-merges --numstat --format=LOG_FORMAT`. */
export function parseGitLog(raw: string): Commit[] {
  return raw
    .split(RS)
    .filter((c) => c.trim())
    .map((chunk) => {
      const [head, ...stat] = chunk.split("\n");
      const [sha, date, author, subject] = head.split(US);
      const files = stat
        .map((l) => /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(l))
        .filter((m): m is RegExpExecArray => !!m)
        .map((m) => ({
          path: m[3],
          added: m[1] === "-" ? 0 : Number(m[1]),
          deleted: m[2] === "-" ? 0 : Number(m[2]),
        }));
      const size = files
        .filter((f) => !NOISE.test(f.path))
        .reduce((n, f) => n + f.added + f.deleted, 0);
      const cc = parseConventional(subject);
      const partial = { sha, date, author, subject, ...cc, files, size };
      return { ...partial, area: classify(partial) };
    });
}

const SCOPES: [Area, RegExp][] = [
  ["security", /^(auth|security|permissions?|sandbox)$/],
  [
    "remote",
    /^(relay|connect|devices?|ssh|remote|clients?|tunnel|pairing|environments?)$/,
  ],
  [
    "agents",
    /^(providers?|codex|claude|pi|opencode|acp|cursor|antigravity|muse|models?|mcp|subagents?|orchestration|agents?|usage|grok)$/,
  ],
  ["settings", /^(settings|keybindings|shortcuts|config|preferences)$/],
];

const WORDS: [Area, RegExp][] = [
  [
    "security",
    /\b(auth|authenticat\w*|authoriz\w*|secrets?|credentials?|csrf|xss|vulnerab\w*|sanitiz\w*|sandbox\w*|security|dpop|oauth)\b/i,
  ],
  [
    "remote",
    /\b(remote|relay|tunnel|ssh|pair(ing|ed)?|devices?|tailscale|multi-machine|another machine|other machines?)\b/i,
  ],
  [
    "agents",
    /\b(providers?|codex|claude|opencode|gemini|cursor|antigravity|subagents?|mcp|acp|model picker|models?)\b/i,
  ],
  ["settings", /\b(settings?|preferences?|keybindings?|shortcuts?)\b/i],
  [
    "perf",
    /\b(perf\w*|faster|slow\w*|latency|memory|oom|leak\w*|cache[sd]?|lazy|debounce\w*|throttl\w*|bundle size)\b/i,
  ],
];

const UI_SCOPES =
  /^(web|mobile|desktop|ui|sidebar|composer|chat|threads?|terminal|marketing|ios|android|onboarding|search|preview)$/;
const MAINTENANCE =
  /^(refactor|test|tests|chore|ci|build|docs|style|revert|lint)$/;

/** Deterministic area for a commit: scope first, then subject words, then type. */
export function classify(c: {
  type: string;
  scope: string;
  subject: string;
}): Area {
  if (MAINTENANCE.test(c.type)) return "maintenance";
  const scopes = c.scope.split(/[,\s]+/).filter(Boolean);
  for (const [area, re] of SCOPES)
    if (scopes.some((s) => re.test(s))) return area;
  if (c.type === "perf") return "perf";
  const text = c.subject.replace(/^\w+(\([^)]*\))?!?:\s*/, "");
  for (const [area, re] of WORDS) if (re.test(text)) return area;
  if (c.type === "feat")
    return scopes.some((s) => UI_SCOPES.test(s)) ? "ux" : "features";
  if (c.type === "fix" && scopes.some((s) => UI_SCOPES.test(s))) return "ux";
  return c.type === "fix" ? "reliability" : "features";
}

// ---- rendering --------------------------------------------------------------

export interface PrInfo {
  number: number;
  title: string;
  url: string;
  body: string;
}

export interface Release {
  tag: string;
  date: string;
  url: string;
  prerelease: boolean;
}

export interface DocChange {
  status: string;
  path: string;
  added: number;
  deleted: number;
  excerpt: string;
}

export interface SummaryInput {
  kind: string;
  repo: string;
  generated: string;
  range: Range;
  fromSha: string | null;
  toSha: string;
  toDate: string;
  commits: Commit[];
  prs: Map<number, PrInfo>;
  releases: Release[] | null;
  docs: DocChange[];
  previous: {
    file: string;
    audited: string;
    to: string;
    topTen: string[];
  } | null;
  agentosSince: string[];
  limits?: { perArea?: number; fixesPerArea?: number; biggest?: number };
}

export function cleanBody(body: string, max = 500): string {
  const text = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/^\s*- \[[ x]\].*$/gim, "")
    .replace(/^#+\s*/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function link(url: string, c: Commit): string {
  return c.pr
    ? `[#${c.pr}](${url}/pull/${c.pr})`
    : `[${c.sha.slice(0, 9)}](${url}/commit/${c.sha})`;
}

function line(url: string, c: Commit): string {
  const title = c.subject.replace(/\s*\(#\d+\)\s*$/, "");
  return `- ${title} ${link(url, c)} (${c.size} lines)`;
}

function count(cs: Commit[], type: string): number {
  return cs.filter((c) => c.type === type).length;
}

export function renderSummary(input: SummaryInput): string {
  const perArea = input.limits?.perArea ?? 40;
  const fixesPerArea = input.limits?.fixesPerArea ?? 8;
  const biggestN = input.limits?.biggest ?? 8;
  const { commits, range } = input;
  const url = repoUrl(input.repo);
  const out: string[] = [];
  const types = new Map<string, number>();
  for (const c of commits) types.set(c.type, (types.get(c.type) ?? 0) + 1);

  out.push(
    `# ${input.repo} changes: ${input.fromSha?.slice(0, 9) ?? "?"}..${input.toSha.slice(0, 9)}`,
    ""
  );
  out.push("Header values for the report's frontmatter:", "", "```yaml");
  out.push(
    `kind: ${input.kind}`,
    `audited: ${input.generated}`,
    `repo: ${input.repo}`
  );
  out.push(`from: ${input.fromSha ?? "none"}`, `to: ${input.toSha}`);
  out.push(`to_date: ${input.toDate}`);
  out.push(`since: ${range.since ?? "n/a"}`, `range_mode: ${range.mode}`);
  out.push(
    `commits: ${commits.length}`,
    `prs: ${new Set(commits.map((c) => c.pr).filter(Boolean)).size}`
  );
  out.push(`previous: ${input.previous?.file ?? "none"}`, "```", "");
  out.push(`Range: ${range.note}.`);
  out.push(
    `Compare: ${url}/compare/${input.fromSha ?? ""}...${input.toSha}`,
    ""
  );
  out.push(
    `By type: ${[...types.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${t} ${n}`)
      .join(", ")}.`,
    ""
  );

  if (input.releases === null) {
    out.push("## Releases", "", "gh unavailable: releases not fetched.", "");
  } else {
    const stable = input.releases.filter((r) => !r.prerelease);
    const pre = input.releases.length - stable.length;
    out.push("## Releases", "");
    for (const r of stable)
      out.push(`- [${r.tag}](${r.url}) ${r.date.slice(0, 10)}`);
    if (stable.length === 0) out.push("- no stable release in range");
    out.push(`- ${pre} prereleases (nightly/preview) in range`, "");
  }

  const biggest = pickBiggest(commits, biggestN);
  if (biggest.length) {
    out.push("## Biggest feature changes (excerpts)", "");
    for (const c of biggest) {
      out.push(
        `### ${c.subject.replace(/\s*\(#\d+\)\s*$/, "")} ${link(url, c)}`,
        ""
      );
      const pr = c.pr ? input.prs.get(c.pr) : undefined;
      if (pr?.body) out.push(cleanBody(pr.body), "");
      const top = c.files
        .filter((f) => !NOISE.test(f.path))
        .sort((a, b) => b.added + b.deleted - (a.added + a.deleted))
        .slice(0, 5)
        .map((f) => `${f.path} +${f.added}/-${f.deleted}`);
      if (top.length) out.push(`Files: ${top.join(", ")}`, "");
    }
  }

  out.push("## By area", "");
  for (const area of Object.keys(AREA_TITLES) as Area[]) {
    const cs = commits.filter((c) => c.area === area);
    if (cs.length === 0) continue;
    out.push(
      `### ${AREA_TITLES[area]}: ${cs.length} commits (feat ${count(cs, "feat")}, fix ${count(cs, "fix")}, perf ${count(cs, "perf")})`,
      ""
    );
    if (area === "maintenance") {
      out.push("Counts only.", "");
      continue;
    }
    const headline = cs
      .filter((c) => c.type !== "fix")
      .sort((a, b) => b.size - a.size);
    for (const c of headline.slice(0, perArea)) out.push(line(url, c));
    if (headline.length > perArea)
      out.push(`- …and ${headline.length - perArea} smaller changes`);
    const fixes = cs
      .filter((c) => c.type === "fix")
      .sort((a, b) => b.size - a.size);
    if (fixes.length) {
      out.push(`- Fixes: ${fixes.length}; the largest:`);
      for (const c of fixes.slice(0, fixesPerArea))
        out.push(`  ${line(url, c)}`);
    }
    out.push("");
  }

  if (input.docs.length) {
    out.push("## Docs changed in range", "");
    for (const d of input.docs) {
      out.push(
        `- ${d.status} [${d.path}](${url}/blob/${input.toSha}/${d.path}) +${d.added}/-${d.deleted}`
      );
      if (d.excerpt) out.push(...d.excerpt.split("\n").map((l) => `  > ${l}`));
    }
    out.push("");
  }

  if (input.previous) {
    out.push(
      `## Previous audit: ${input.previous.file} (${input.previous.audited})`,
      ""
    );
    out.push(
      "Previous top 10 (mark each shipped by us, still open, or dropped):"
    );
    input.previous.topTen.forEach((t, i) => out.push(`${i + 1}. ${t}`));
    if (input.previous.topTen.length === 0) out.push("- none found");
    out.push("", "AgentOS commits since the previous audit:");
    if (input.agentosSince.length === 0) out.push("- none");
    for (const s of input.agentosSince) out.push(`- ${s}`);
    out.push("");
  }
  return out.join("\n");
}

// ---- index ------------------------------------------------------------------

export function renderIndex(
  kind: string,
  repo: string,
  reports: { file: string; fm: Record<string, string> }[]
): string {
  const byFile = new Map(reports.map((r) => [r.file, r]));
  const rows = sortReports([...byFile.keys()])
    .reverse()
    .map((file) => ({ file, fm: byFile.get(file)!.fm }))
    .map(({ file, fm }) => {
      const from =
        fm.from && fm.from !== "none"
          ? fm.from.slice(0, 9)
          : `since ${fm.since ?? "?"}`;
      const to = (fm.to ?? "?").slice(0, 9);
      return `| [${file.replace(/\.md$/, "")}](${file}) | ${from}..${to} | ${fm.commits ?? "?"} |`;
    });
  return [
    `# ${kind} audits`,
    "",
    `Runs of \`/competitor-audit ${kind}\` against ${repoUrl(repo)}, newest first.`,
    "",
    "| Run | Commit range | Commits |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}
