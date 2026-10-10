/**
 * A PR no AgentOS task owns (opened by dispatch, a person, dependabot) in a
 * repository of one of the workspace's projects. It's a lightweight record,
 * not a task: no session, keyed "pr:owner/repo#N" for its checks, gate
 * failures and asks. sign_off and review take one by #N, owner/repo#N or
 * URL, and refuse a repository outside the workspace.
 */

import { db, type Project, type Session } from "../db";
import { run, toTaskPR, type ListedPR } from "../tasks/gh";
import type { TaskPR } from "../tasks/state";
import { getWorkspace } from "../workspaces";
import { EXTERNAL_PREFIX } from "./asks";
import { prKey } from "./ask-settle";
import { repoSlug, workspaceRepos, type WorkspaceRepo } from "./repo-slug";
import { expandHome } from "../tasks/session";
import { workspaceTask } from "./targets";

export interface PRRef {
  // owner/repo, lower case; null for a bare #N.
  slug: string | null;
  number: number;
}

// #12, 12, owner/repo#12, pr:owner/repo#12 (a stored key) or a pull URL.
export function parsePRRef(ref: string): PRRef | null {
  const r = ref.trim();
  const bare = /^#?(\d+)$/.exec(r);
  if (bare) return { slug: null, number: Number(bare[1]) };
  const short = new RegExp(
    `^(?:${EXTERNAL_PREFIX})?([\\w.-]+/[\\w.-]+)#(\\d+)$`
  ).exec(r);
  if (short) return { slug: short[1].toLowerCase(), number: Number(short[2]) };
  const url =
    /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:[/?#]|$)/i.exec(
      r
    );
  return url ? { slug: url[1].toLowerCase(), number: Number(url[2]) } : null;
}

export interface ExternalPR {
  id: string;
  // owner/repo#N
  name: string;
  slug: string;
  number: number;
  url: string;
  title: string;
  body: string;
  project: Project;
  repo: string;
  base: string;
  branch: string;
  draft: boolean;
  labels: string[];
  pr: TaskPR;
}

type WorkspaceTask = Session & { project_name: string };

export type GateTarget =
  | { kind: "task"; task: WorkspaceTask }
  | { kind: "external"; pr: ExternalPR };

const FIELDS =
  "number,url,state,headRefOid,headRefName,baseRefName,isDraft,labels,isCrossRepository,statusCheckRollup,body,title";

interface ViewedPR extends ListedPR {
  baseRefName?: string;
  isDraft?: boolean;
  labels?: { name?: string }[];
  title?: string;
}

async function viewPR(r: WorkspaceRepo, n: number): Promise<ViewedPR> {
  const out = await run(
    "gh",
    ["pr", "view", String(n), "--repo", r.slug, "--json", FIELDS],
    r.dir,
    15000
  );
  return JSON.parse(out) as ViewedPR;
}

function workspaceName(workspaceId: string): string {
  return getWorkspace(workspaceId)?.name ?? "this workspace";
}

const unique = (repos: WorkspaceRepo[]) => [
  ...new Map(repos.map((r) => [r.slug, r])).values(),
];

// The tasks of this workspace whose PR is this one.
function tasksWithPR(workspaceId: string, ref: PRRef): WorkspaceTask[] {
  const rows = db
    .prepare(
      `SELECT s.*, p.name AS project_name FROM sessions s
       JOIN projects p ON p.id = s.project_id
       WHERE p.workspace_id = ? AND s.pr_number = ? AND s.task_status IS NOT NULL
       ORDER BY s.created_at DESC`
    )
    .all(workspaceId, ref.number) as WorkspaceTask[];
  const key = ref.slug && `${ref.slug}#${ref.number}`;
  return rows.filter((t) => !key || !t.pr_url || prKey(t.pr_url) === key);
}

type OwnerRow = WorkspaceTask & {
  owner_workspace: string | null;
  project_dir: string;
  project_host: string | null;
};

// The task that owns this PR, in any workspace on any machine: one whose
// recorded PR is it, or one working on its branch in a clone of its
// repository (a PR the row hasn't caught up with is still the task's). A
// project whose repository can't be read here (another machine's, a folder
// gone, a remote that isn't plainly GitHub's) counts as the same
// repository: it's refused rather than gated as no one's.
async function ownerOf(
  slug: string,
  number: number,
  branch: string
): Promise<OwnerRow | null> {
  const rows = db
    .prepare(
      `SELECT s.*, p.name AS project_name, p.workspace_id AS owner_workspace,
         p.working_directory AS project_dir, p.host_id AS project_host
       FROM sessions s JOIN projects p ON p.id = s.project_id
       WHERE s.task_status IS NOT NULL
         AND (s.pr_number = ? OR (s.branch_name = ? AND s.task_status IN ('running', 'moving', 'moved')))
       ORDER BY s.created_at DESC`
    )
    .all(number, branch) as OwnerRow[];
  const key = `${slug}#${number}`;
  for (const t of rows) {
    if (t.pr_url) {
      if (prKey(t.pr_url) === key) return t;
      if (t.pr_number === number && t.branch_name !== branch) continue;
    }
    if (t.branch_name !== branch && t.pr_number !== number) continue;
    const local = !t.project_host || t.project_host === "local";
    const theirs = local ? await repoSlug(expandHome(t.project_dir)) : null;
    if (theirs === null || theirs === slug) return t;
  }
  return null;
}

// Branch names come from GitHub and reach git as arguments: only plain ones.
const PLAIN_REF = /^[\w][\w./+-]*$/;
const plainRef = (r: string) => PLAIN_REF.test(r) && !r.includes("..");

// The open PR the ref names in one of the workspace's repositories, or the
// task that owns it; refuses anything else, saying why.
async function externalPR(
  workspaceId: string,
  ref: PRRef
): Promise<ExternalPR | WorkspaceTask> {
  const repos = await workspaceRepos(workspaceId);
  const known = unique(repos);
  const listed = known.map((r) => r.slug).join(", ") || "none";
  const shown = ref.slug ? `${ref.slug}#${ref.number}` : `#${ref.number}`;
  const candidates = ref.slug
    ? known.filter((r) => r.slug === ref.slug)
    : known;
  if (!candidates.length)
    throw new Error(
      ref.slug
        ? `${ref.slug} isn't the repository of any project in ${workspaceName(workspaceId)} (its repositories: ${listed}). The orchestrator merges only inside its workspace.`
        : `No task has PR ${shown}, and none of ${workspaceName(workspaceId)}'s projects is a GitHub clone on this machine to look it up in.`
    );
  let found: { repo: WorkspaceRepo; pr: ViewedPR };
  if (candidates.length === 1) {
    found = {
      repo: candidates[0],
      pr: await viewPR(candidates[0], ref.number),
    };
  } else {
    const seen = await Promise.all(
      candidates.map((repo) =>
        viewPR(repo, ref.number).then(
          (pr) => ({ repo, pr }),
          () => null
        )
      )
    );
    const open = seen.filter(
      (s): s is { repo: WorkspaceRepo; pr: ViewedPR } => s?.pr.state === "OPEN"
    );
    if (open.length > 1)
      throw new Error(
        `PR ${shown} is open in ${open.map((o) => o.repo.slug).join(" and ")}: say which, as owner/repo#${ref.number}`
      );
    if (!open.length)
      throw new Error(
        `No task has PR ${shown}, and no open PR ${shown} is in this workspace's repositories (${listed})`
      );
    found = open[0];
  }
  const { repo, pr } = found;
  const name = `${repo.slug}#${pr.number}`;
  if (pr.state !== "OPEN")
    throw new Error(`${name} is ${pr.state.toLowerCase()}, not open`);
  if (pr.isCrossRepository)
    throw new Error(
      `${name} comes from a fork; the orchestrator merges only PRs whose branch is in ${repo.slug}`
    );
  const branch = pr.headRefName ?? "";
  const base = pr.baseRefName || "main";
  if (!plainRef(branch) || !plainRef(base))
    throw new Error(
      `${name}'s branch names aren't plain ones (letters, digits, . _ / + -); the orchestrator doesn't pass them to git`
    );
  const owner = await ownerOf(repo.slug, pr.number, branch);
  if (owner && owner.owner_workspace !== workspaceId)
    throw new Error(
      `${name} is task ${owner.name}'s PR in another workspace; the orchestrator acts only on its own workspace's tasks`
    );
  if (owner) return owner;
  return {
    id: `${EXTERNAL_PREFIX}${name}`,
    name,
    slug: repo.slug,
    number: pr.number,
    url: pr.url,
    title: pr.title ?? "",
    body: pr.body ?? "",
    project: repo.project,
    repo: repo.dir,
    base,
    branch,
    draft: !!pr.isDraft,
    labels: (pr.labels ?? []).map((l) => l.name ?? "").filter(Boolean),
    pr: await toTaskPR(repo.dir, pr),
  };
}

// What sign_off and review act on: a task by name, id or PR, else a PR no
// task owns in one of the workspace's repositories.
export async function gateTarget(
  workspaceId: string,
  ref: string
): Promise<GateTarget> {
  const parsed = parsePRRef(ref);
  if (!parsed) return { kind: "task", task: workspaceTask(workspaceId, ref) };
  const owned = tasksWithPR(workspaceId, parsed);
  if (owned.length === 1) return { kind: "task", task: owned[0] };
  if (owned.length > 1)
    throw new Error(
      `PR #${parsed.number} is a task in ${owned.length} projects here; name the task`
    );
  const found = await externalPR(workspaceId, parsed);
  return "task_status" in found
    ? { kind: "task", task: found }
    : { kind: "external", pr: found };
}
