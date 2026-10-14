// A task's agent opened a PR in a repository that isn't its task's: nothing
// polls that repository for the task's branch, so no task owns the PR and no
// CI or review gate runs. The PRs agents open are read back from their
// stored `gh pr create` calls, and one outside its task's repository is
// raised to the orchestrator once.

import { db, type Session } from "../db";
import { getSetting, putSetting } from "../settings-store";
import { sessionWorkspace } from "../models/resolve";
import { run } from "../tasks/gh";
import { expandHome } from "../tasks/session";
import { workspaceProjects } from "./brief";
import { queueEventOnce } from "./events";
import { repoSlug } from "./repo-slug";

const MARK = "reconcile.chat_items_rowid";
// An item is stored when its tool call starts and updated when it ends, so a
// call that finished after the mark moved past it is still inside the window.
const OVERLAP = 2000;
const BATCH = 500;
const EVERY_MS = 2 * 60 * 1000;
const PR_URL = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g;
const CREATE = /\bgh\s+pr\s+create\b/;

export interface ReconcileDeps {
  slugOf: (dir: string) => Promise<string | null>;
  // The PR's state and head branch, or null when it can't be read.
  view: (url: string) => Promise<{ state: string; head: string } | null>;
}

export const realReconcileDeps: ReconcileDeps = {
  slugOf: repoSlug,
  view: async (url) => {
    try {
      const out = await run(
        "gh",
        ["pr", "view", url, "--json", "state,headRefName"],
        process.cwd(),
        15000
      );
      const pr = JSON.parse(out) as { state: string; headRefName: string };
      return { state: pr.state, head: pr.headRefName };
    } catch {
      return null;
    }
  },
};

// Stores every PR URL an agent's `gh pr create` printed since last time.
export function recordAgentPrs(): number {
  const top =
    (
      db.prepare(`SELECT MAX(rowid) AS m FROM chat_items`).get() as {
        m: number | null;
      }
    ).m ?? 0;
  const mark = Number(getSetting(MARK) ?? top - OVERLAP);
  const rows = db
    .prepare(
      `SELECT rowid AS rid, session_id, data FROM chat_items
       WHERE rowid > ? AND data LIKE '%pr create%' AND data LIKE '%/pull/%'
       ORDER BY rowid LIMIT ?`
    )
    .all(mark - OVERLAP, BATCH) as {
    rid: number;
    session_id: string;
    data: string;
  }[];
  const insert = db.prepare(
    `INSERT OR IGNORE INTO agent_prs (url, session_id, repo, number) VALUES (?, ?, ?, ?)`
  );
  let added = 0;
  for (const row of rows) {
    let item: { kind?: string; input?: unknown; output?: unknown };
    try {
      item = JSON.parse(row.data);
    } catch {
      continue;
    }
    if (
      item.kind !== "tool" ||
      typeof item.output !== "string" ||
      !CREATE.test(JSON.stringify(item.input ?? ""))
    )
      continue;
    for (const m of item.output.matchAll(PR_URL))
      added += insert.run(
        m[0],
        row.session_id,
        `${m[1]}/${m[2]}`.toLowerCase(),
        Number(m[3])
      ).changes;
  }
  putSetting(MARK, String(rows.length === BATCH ? rows[BATCH - 1].rid : top));
  return added;
}

interface AgentPr {
  url: string;
  session_id: string;
  repo: string;
  number: number;
}

const told = (url: string) =>
  db
    .prepare(`UPDATE agent_prs SET told_at = datetime('now') WHERE url = ?`)
    .run(url);

async function ownedBy(
  pr: AgentPr,
  head: string,
  deps: ReconcileDeps
): Promise<boolean> {
  const rows = db
    .prepare(
      `SELECT s.pr_url, s.branch_name, p.working_directory FROM sessions s
       LEFT JOIN projects p ON p.id = s.project_id
       WHERE s.task_status IS NOT NULL AND (LOWER(s.pr_url) = ? OR s.branch_name = ?)`
    )
    .all(pr.url.toLowerCase(), head) as {
    pr_url: string | null;
    branch_name: string | null;
    working_directory: string | null;
  }[];
  for (const r of rows) {
    if (r.pr_url?.toLowerCase() === pr.url.toLowerCase()) return true;
    if (
      r.working_directory &&
      (await deps.slugOf(expandHome(r.working_directory))) === pr.repo
    )
      return true;
  }
  return false;
}

// Raises each unclaimed agent PR outside its task's repository, once.
export async function classifyAgentPrs(
  deps: ReconcileDeps = realReconcileDeps,
  now = Date.now()
): Promise<number> {
  const open = db
    .prepare(`SELECT * FROM agent_prs WHERE told_at IS NULL`)
    .all() as AgentPr[];
  let raised = 0;
  for (const pr of open) {
    const task = db
      .prepare(`SELECT * FROM sessions WHERE id = ?`)
      .get(pr.session_id) as Session | undefined;
    const workspaceId = task ? sessionWorkspace(task) : null;
    if (!task || !workspaceId) {
      told(pr.url);
      continue;
    }
    const projects = workspaceProjects(workspaceId);
    const slugs = await Promise.all(
      projects.map(async (p) => ({
        name: p.name,
        id: p.id,
        slug: await deps.slugOf(expandHome(p.working_directory)),
      }))
    );
    const own = slugs.find((p) => p.id === task.project_id);
    // Its own repository is polled for its branch like any task's.
    if (own?.slug === pr.repo) {
      told(pr.url);
      continue;
    }
    const view = await deps.view(pr.url);
    // Unreadable now: look again next time.
    if (!view) continue;
    if (view.state !== "OPEN" || (await ownedBy(pr, view.head, deps))) {
      told(pr.url);
      continue;
    }
    const where = slugs.find((p) => p.slug === pr.repo);
    queueEventOnce(
      workspaceId,
      `stray-pr:${pr.url}`,
      task.id,
      `Task "${task.name}" opened a PR outside its repo: ${pr.url} (${where ? `project ${where.name} of this workspace` : "not a repository of this workspace"}). No task owns it, so no CI or review gate runs on it: review and sign it off as an external PR, or drop it.`,
      now
    );
    told(pr.url);
    raised++;
  }
  return raised;
}

let last = 0;

// From the settle loop; reads stored chat items, so a restart loses nothing.
export async function reconcileSweep(
  now = Date.now(),
  deps: ReconcileDeps = realReconcileDeps
): Promise<void> {
  if (now - last < EVERY_MS) return;
  last = now;
  recordAgentPrs();
  await classifyAgentPrs(deps, now);
}
