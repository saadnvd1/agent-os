// `aos branches prune`: the stale remote branches AgentOS tasks left behind.
// A branch is stale when it is a task's recorded branch, its latest PR is
// merged or closed at the branch's current commit, and no open PR builds on
// it. Dry run by default; deleting goes through the same checks as a merge.

import { db } from "../db";
import { run } from "./gh";
import { PROTECTED_BRANCHES, deleteTaskBranch } from "./remote-branch";

export interface PruneRepo {
  dir: string;
  slug: string;
  projectIds: string[];
}

export interface StaleBranch {
  branch: string;
  pr: number;
  state: "MERGED" | "CLOSED";
  head: string;
}

export interface RepoPrune {
  slug: string;
  stale: StaleBranch[];
  kept: { branch: string; why: string }[];
  deleted: string[];
}

interface ListedPR {
  number: number;
  state: string;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  isCrossRepository: boolean;
}

const taskBranches = (projectIds: string[]): Set<string> => {
  if (!projectIds.length) return new Set();
  const rows = db
    .prepare(
      `SELECT DISTINCT branch_name FROM session_rows
       WHERE branch_name IS NOT NULL
         AND project_id IN (${projectIds.map(() => "?").join(", ")})`
    )
    .all(...projectIds) as { branch_name: string }[];
  return new Set(rows.map((r) => r.branch_name));
};

async function remoteBranches(repo: PruneRepo): Promise<Map<string, string>> {
  const out = await run(
    "gh",
    [
      "api",
      `repos/${repo.slug}/branches`,
      "--paginate",
      "--jq",
      ".[] | [.name, .commit.sha] | @tsv",
    ],
    repo.dir,
    120000
  );
  const tips = new Map<string, string>();
  for (const line of out.split("\n")) {
    const [name, sha] = line.split("\t");
    if (name && sha) tips.set(name, sha);
  }
  return tips;
}

export async function pruneRepo(
  repo: PruneRepo,
  opts: { yes?: boolean } = {}
): Promise<RepoPrune> {
  const [tips, prsOut, defaultOut] = await Promise.all([
    remoteBranches(repo),
    run(
      "gh",
      [
        "pr",
        "list",
        "--repo",
        repo.slug,
        "--state",
        "all",
        "--limit",
        "1000",
        "--json",
        "number,state,headRefName,headRefOid,baseRefName,isCrossRepository",
      ],
      repo.dir,
      120000
    ),
    run(
      "gh",
      [
        "repo",
        "view",
        repo.slug,
        "--json",
        "defaultBranchRef",
        "--jq",
        ".defaultBranchRef.name",
      ],
      repo.dir,
      20000
    ),
  ]);
  const prs = JSON.parse(prsOut) as ListedPR[];
  const defaultBranch = defaultOut.trim();
  const mine = taskBranches(repo.projectIds);
  const result: RepoPrune = {
    slug: repo.slug,
    stale: [],
    kept: [],
    deleted: [],
  };
  const keep = (branch: string, why: string) =>
    result.kept.push({ branch, why });

  for (const [branch, tip] of [...tips].sort()) {
    if (branch === defaultBranch || PROTECTED_BRANCHES.has(branch)) continue;
    if (!mine.has(branch)) {
      keep(branch, "not an AgentOS task's branch");
      continue;
    }
    const own = prs
      .filter((p) => p.headRefName === branch && !p.isCrossRepository)
      .sort((a, b) => b.number - a.number);
    if (!own.length) {
      keep(branch, "no PR");
      continue;
    }
    const open = prs.find(
      (p) =>
        p.state === "OPEN" &&
        (p.baseRefName === branch ||
          (p.headRefName === branch && !p.isCrossRepository))
    );
    if (open) {
      keep(branch, `open PR #${open.number}`);
      continue;
    }
    const latest = own[0];
    if (latest.headRefOid !== tip) {
      keep(branch, `moved to ${tip.slice(0, 7)} after PR #${latest.number}`);
      continue;
    }
    result.stale.push({
      branch,
      pr: latest.number,
      state: latest.state as StaleBranch["state"],
      head: latest.headRefOid,
    });
  }

  if (opts.yes)
    for (const s of result.stale) {
      const out = await deleteTaskBranch({
        repo: repo.dir,
        slug: repo.slug,
        branch: s.branch,
        prHead: s.head,
        keep: [defaultBranch],
      });
      if (out.deleted) result.deleted.push(s.branch);
      else keep(s.branch, out.why);
    }
  return result;
}

export function pruneText(results: RepoPrune[], yes: boolean): string {
  const lines: string[] = [];
  let total = 0;
  for (const r of results) {
    lines.push(`${r.slug}:`);
    const list = yes ? r.deleted : r.stale.map((s) => s.branch);
    total += list.length;
    for (const s of r.stale)
      if (!yes || r.deleted.includes(s.branch))
        lines.push(
          `  ${yes ? "deleted" : "stale"}  ${s.branch}  (PR #${s.pr} ${s.state.toLowerCase()})`
        );
    for (const k of r.kept) lines.push(`  kept   ${k.branch}  (${k.why})`);
  }
  lines.push(
    yes
      ? `Deleted ${total} branch${total === 1 ? "" : "es"}.`
      : `${total} stale branch${total === 1 ? "" : "es"}. Dry run: aos branches prune --yes deletes them.`
  );
  return lines.join("\n");
}
