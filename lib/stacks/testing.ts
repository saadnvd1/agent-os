// Test fixtures: a project, task sessions and a stack in the test database.

import { randomUUID } from "crypto";
import { db, stackQueries as q, type StackItemStatus } from "../db";
import { createProject } from "../projects";

export interface SeedItem {
  key: string;
  parent?: string;
  blockers?: string[];
  status: StackItemStatus;
  branch?: string;
  worktree?: string;
  baseTip?: string;
  baseBranch?: string;
  pr?: number;
}

export function seedStack(repo: string, specs: SeedItem[]) {
  const project = createProject({
    name: `p-${randomUUID().slice(0, 6)}`,
    workingDirectory: repo,
  });
  const stackId = randomUUID();
  const ids = new Map(specs.map((s) => [s.key, randomUUID()]));
  const sessions = new Map<string, string>();
  for (const s of specs) {
    if (!s.branch) continue;
    const id = randomUUID();
    sessions.set(s.key, id);
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, project_id, task_status,
         branch_name, worktree_path, base_branch, pr_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      s.key,
      `claude-${id}`,
      s.worktree ?? repo,
      project.id,
      s.status === "merged" ? "merged" : "running",
      s.branch,
      s.worktree ?? null,
      s.baseBranch ?? null,
      s.pr ?? null
    );
  }
  q.create(
    db,
    {
      id: stackId,
      project_id: project.id,
      lh_board_id: "board",
      name: "Stack",
      max_parallel: 3,
    },
    specs.map((s, position) => ({
      id: ids.get(s.key)!,
      position,
      lh_card_id: `card-${s.key}`,
      ticket: s.key,
      title: s.key,
      parent_item_id: s.parent ? ids.get(s.parent)! : null,
      also_item_ids: "[]",
      blocker_item_ids: JSON.stringify(
        (s.blockers ?? (s.parent ? [s.parent] : [])).map((b) => ids.get(b))
      ),
      status: s.status,
      session_id: sessions.get(s.key) ?? null,
      base_branch: s.baseBranch ?? null,
      base_tip: s.baseTip ?? null,
      note: null,
    }))
  );
  for (const s of specs) {
    if (s.pr) q.updateItem(db, ids.get(s.key)!, { pr_number: s.pr });
  }
  return {
    projectId: project.id,
    stackId,
    item: (key: string) => q.item(db, ids.get(key)!)!,
    session: (key: string) => sessions.get(key)!,
  };
}
