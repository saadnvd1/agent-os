// Collects what a competitor's GitHub repo shipped since the last audit into
// one compact markdown summary, so the /competitor-audit skill reads that
// instead of the repo.
//
//   npx tsx scripts/competitor-audit/audit.ts [slug]          # fetch + summarise, prints JSON
//   npx tsx scripts/competitor-audit/audit.ts index [slug]    # rebuild the reports' README.md
//   npx tsx scripts/competitor-audit/audit.ts excerpt pr <n> [slug] | excerpt doc <path> [slug]
//
// Competitors are configured locally, never in this repo:
//   ~/.config/agent-os/competitors.json   {"<slug>": {"repo": "owner/name", "branch": "main"}}
// Reports are local only: $AGENTOS_AUDITS_DIR/<slug> (default ~/.agent-os/audits/<slug>).
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  LOG_FORMAT,
  REPO_RE,
  SLUG_RE,
  daysBefore,
  fetchSince,
  isValidSha,
  nextReportName,
  parseFrontmatter,
  parseGitLog,
  previousFromReport,
  pickBiggest,
  renderIndex,
  renderSummary,
  repoUrl,
  resolveRange,
  sortReports,
  SUMMARY_RULE,
  type DocChange,
  type PrInfo,
  type Release,
} from "./lib";
import { untrusted } from "../../lib/orchestrator/untrusted";

const CONFIG =
  process.env.AGENTOS_COMPETITORS ||
  path.join(os.homedir(), ".config", "agent-os", "competitors.json");
const AUDITS =
  process.env.AGENTOS_AUDITS_DIR ||
  path.join(os.homedir(), ".agent-os", "audits");
const CACHE = path.join(
  process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"),
  "agentos",
  "competitors"
);
const AGENTOS_ROOT = path.resolve(__dirname, "..", "..");
const TO_REF = "refs/remotes/origin/audited";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function loadCompetitor(slug: string | undefined) {
  if (!fs.existsSync(CONFIG))
    fail(
      `No competitors configured. Create ${CONFIG} as {"<slug>": {"repo": "owner/name"}}.`
    );
  const all = JSON.parse(fs.readFileSync(CONFIG, "utf8")) as Record<
    string,
    { repo?: string; branch?: string }
  >;
  const slugs = Object.keys(all);
  const pick = slug ?? (slugs.length === 1 ? slugs[0] : undefined);
  if (!pick)
    fail(`Name a competitor: ${slugs.join(", ") || "(none configured)"}`);
  const entry = all[pick];
  if (!entry)
    fail(`Unknown competitor "${pick}". Configured: ${slugs.join(", ")}`);
  if (!SLUG_RE.test(pick)) fail(`Slug "${pick}" must match ${SLUG_RE}`);
  if (!entry.repo || !REPO_RE.test(entry.repo))
    fail(`"${pick}" needs "repo": "owner/name" in ${CONFIG}`);
  const branch = entry.branch || "main";
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith("-"))
    fail(`Bad branch "${branch}" for "${pick}"`);
  return {
    slug: pick,
    repo: entry.repo,
    branch,
    clone: path.join(CACHE, pick),
    reports: path.join(AUDITS, pick),
  };
}
type Competitor = ReturnType<typeof loadCompetitor>;

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
const tryRun = (fn: () => string): string | null => {
  try {
    return fn();
  } catch {
    return null;
  }
};

function updateClone(c: Competitor, since: string) {
  const git = (...args: string[]) => run("git", ["-C", c.clone, ...args]);
  if (!fs.existsSync(path.join(c.clone, ".git"))) {
    fs.mkdirSync(c.clone, { recursive: true });
    git("init", "--quiet");
    git("remote", "add", "origin", `${repoUrl(c.repo)}.git`);
  }
  git(
    "fetch",
    "--quiet",
    "--no-tags",
    `--shallow-since=${since}`,
    "origin",
    `+refs/heads/${c.branch}:${TO_REF}`
  );
  return git;
}

function previousReport(c: Competitor) {
  if (!fs.existsSync(c.reports)) return { names: [] as string[], prev: null };
  const names = sortReports(fs.readdirSync(c.reports));
  const last = names.at(-1);
  if (!last) return { names, prev: null };
  const md = fs.readFileSync(path.join(c.reports, last), "utf8");
  return { names, prev: previousFromReport(last, md) };
}

function fetchPrs(repo: string, numbers: number[]): Map<number, PrInfo> {
  const out = new Map<number, PrInfo>();
  if (numbers.length === 0) return out;
  const [owner, name] = repo.split("/");
  const fields = numbers
    .map((n) => `p${n}: pullRequest(number: ${n}) { number title url body }`)
    .join("\n");
  const raw = tryRun(() =>
    run("gh", [
      "api",
      "graphql",
      "-f",
      `query=query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`,
      "-f",
      `owner=${owner}`,
      "-f",
      `name=${name}`,
    ])
  );
  if (!raw) return out;
  const found = JSON.parse(raw).data?.repository ?? {};
  for (const pr of Object.values(found) as (PrInfo | null)[])
    if (pr) out.set(pr.number, pr);
  return out;
}

function fetchReleases(repo: string, since: string): Release[] | null {
  const out: Release[] = [];
  for (let page = 1; page <= 20; page++) {
    const raw = tryRun(() =>
      run("gh", [
        "api",
        `repos/${repo}/releases?per_page=100&page=${page}`,
        "--jq",
        "[.[] | {tag: .tag_name, date: (.published_at // .created_at), url: .html_url, prerelease}]",
      ])
    );
    if (raw === null) return page === 1 ? null : out;
    const batch = JSON.parse(raw) as Release[];
    out.push(...batch.filter((r) => r.date >= since));
    if (batch.length < 100 || batch.some((r) => r.date < since)) break;
  }
  return out;
}

const DOC_PATH = /^(docs\/.*\.mdx?|[^/]+\.md|CHANGELOG[^/]*)$/i;

function docChanges(
  git: (...a: string[]) => string,
  from: string,
  to: string
): DocChange[] {
  const stats = new Map<string, { added: number; deleted: number }>();
  for (const l of git("diff", "--numstat", "--end-of-options", from, to).split(
    "\n"
  )) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(l);
    if (m)
      stats.set(m[3], { added: Number(m[1]) || 0, deleted: Number(m[2]) || 0 });
  }
  const changes = git(
    "diff",
    "--name-status",
    "--no-renames",
    "--end-of-options",
    from,
    to
  )
    .split("\n")
    .map((l) => l.split("\t"))
    .filter(([s, p]) => s && p && DOC_PATH.test(p))
    .map(([status, p]) => ({
      status,
      path: p,
      ...(stats.get(p) ?? { added: 0, deleted: 0 }),
      excerpt: "",
    }))
    .sort((a, b) => b.added + b.deleted - (a.added + a.deleted))
    .slice(0, 40);
  // Excerpts: the opening of each new doc, the added lines of the 3 most-changed others.
  let modified = 0;
  for (const d of changes) {
    if (d.status === "A") {
      const text = tryRun(() => git("show", `${to}:${d.path}`)) ?? "";
      d.excerpt = text
        .replace(/^---\n[\s\S]*?\n---\n/, "")
        .split("\n")
        .filter((l) => l.trim())
        .slice(0, 8)
        .join("\n");
    } else if (d.status === "M" && modified++ < 3) {
      d.excerpt = git("diff", "-U0", "--end-of-options", from, to, "--", d.path)
        .split("\n")
        .filter(
          (l) => l.startsWith("+") && !l.startsWith("+++") && l.slice(1).trim()
        )
        .slice(0, 12)
        .map((l) => l.slice(1))
        .join("\n");
    }
  }
  return changes;
}

function agentosCommitsSince(date: string): string[] {
  for (const ref of ["origin/main", "main"]) {
    const raw = tryRun(() =>
      run("git", [
        "-C",
        AGENTOS_ROOT,
        "log",
        "--no-merges",
        "--format=%h %s",
        `--since=${date} 00:00`,
        ref,
      ])
    );
    if (raw !== null) return raw.split("\n").filter(Boolean).slice(0, 80);
  }
  return [];
}

function summarise(c: Competitor) {
  const today = new Date().toLocaleDateString("en-CA");
  const { names, prev } = previousReport(c);
  const git = updateClone(c, fetchSince(prev?.audited, today));

  const toSha = git("rev-parse", TO_REF).trim();
  const toDate = git("show", "-s", "--format=%cI", toSha).trim();
  const range = resolveRange({
    prevSha: prev?.to,
    prevDate: prev?.audited,
    today,
    isAncestor: (sha) =>
      isValidSha(sha) &&
      tryRun(() => git("merge-base", "--is-ancestor", sha, toSha)) !== null,
  });

  const logArgs = ["log", "--no-merges", "--numstat", `--format=${LOG_FORMAT}`];
  const commits = parseGitLog(
    range.mode === "sha"
      ? git(...logArgs, `${range.fromSha}..${toSha}`)
      : git(...logArgs, `--since=${range.since}T00:00:00Z`, toSha)
  );
  let fromSha = range.fromSha;
  if (!fromSha && commits.length) {
    fromSha = tryRun(() =>
      git(
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${commits.at(-1)!.sha}^`
      ).trim()
    );
    if (!isValidSha(fromSha)) fromSha = null;
  }
  const sinceDate =
    range.since ??
    (fromSha
      ? git("show", "-s", "--format=%cI", fromSha).trim()
      : daysBefore(today, 7));

  const biggest = pickBiggest(commits, 8);
  const prs = fetchPrs(
    c.repo,
    biggest.map((x) => x.pr).filter((n): n is number => n !== null)
  );
  const releases = fetchReleases(c.repo, sinceDate);
  const docs = fromSha ? docChanges(git, fromSha, toSha) : [];

  const summary = renderSummary({
    kind: c.slug,
    repo: c.repo,
    generated: today,
    range,
    fromSha,
    toSha,
    toDate,
    commits,
    prs,
    releases,
    docs,
    previous: prev,
    agentosSince: prev ? agentosCommitsSince(prev.audited) : [],
  });

  const reportName = nextReportName(names, today);
  const summaryPath = path.join(CACHE, `${c.slug}-summaries`, reportName);
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, summary);
  console.log(
    JSON.stringify(
      {
        competitor: c.slug,
        repo: c.repo,
        summary: summaryPath,
        report: path.join(c.reports, reportName),
        index: path.join(c.reports, "README.md"),
        from: fromSha,
        to: toSha,
        range: range.note,
        commits: commits.length,
        releases: releases?.length ?? null,
        previous: prev?.file ?? null,
        approxTokens: Math.round(summary.length / 4),
      },
      null,
      2
    )
  );
}

function writeIndex(c: Competitor) {
  fs.mkdirSync(c.reports, { recursive: true });
  const reports = sortReports(fs.readdirSync(c.reports)).map((file) => ({
    file,
    fm: parseFrontmatter(fs.readFileSync(path.join(c.reports, file), "utf8")),
  }));
  const index = path.join(c.reports, "README.md");
  fs.writeFileSync(index, renderIndex(c.slug, c.repo, reports));
  console.log(index);
}

/** A targeted excerpt of one PR body or doc, fenced as untrusted like the summary. */
function excerpt(c: Competitor, kind: string, target: string) {
  let text: string | null = null;
  if (kind === "pr" && /^\d+$/.test(target)) {
    text = tryRun(() =>
      run("gh", [
        "pr",
        "view",
        target,
        "-R",
        c.repo,
        "--json",
        "body",
        "-q",
        ".body",
      ])
    );
  } else if (
    kind === "doc" &&
    DOC_PATH.test(target) &&
    !target.includes("..")
  ) {
    text = tryRun(() =>
      run("git", ["-C", c.clone, "show", `${TO_REF}:${target}`])
    );
  } else {
    fail(
      "Usage: audit.ts excerpt pr <number> [slug] | excerpt doc <docs path> [slug]"
    );
  }
  if (text === null) fail(`Couldn't read ${kind} ${target}`);
  const lines = text
    .split("\n")
    .filter((l) => l.trim())
    .slice(0, 80);
  console.log(SUMMARY_RULE);
  console.log(
    untrusted(`competitor ${kind} ${target}`, `\n${lines.join("\n")}\n`)
  );
}

const [first, second, third, fourth] = process.argv.slice(2);
if (first === "index") writeIndex(loadCompetitor(second));
else if (first === "excerpt") excerpt(loadCompetitor(fourth), second, third);
else summarise(loadCompetitor(first));
