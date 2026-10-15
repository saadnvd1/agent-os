// Test fixtures: a workspace with two projects and a few sessions in the
// test database.

import { randomUUID } from "crypto";
import { db, insertSessionRow } from "../db";
import { saveItem } from "../chat/store";
import { createProject } from "../projects";
import { createWorkspace, setProjectWorkspace } from "../workspaces";

export function seedSession(opts: {
  projectId: string;
  name: string;
  view?: "chat" | "terminal";
  task?: boolean;
  branch?: string;
  updatedAt?: string;
}): string {
  const id = randomUUID();
  insertSessionRow(db, {
    id,
    name: opts.name,
    tmux_name: `claude-${id}`,
    working_directory: "/tmp",
    project_id: opts.projectId,
    view: opts.view ?? "terminal",
    task_status: opts.task ? "running" : null,
    branch_name: opts.branch ?? null,
    updated_at: opts.updatedAt,
  });
  return id;
}

export function seedWorkspace(name = `ws-${randomUUID().slice(0, 6)}`) {
  const workspace = createWorkspace(name);
  const app = createProject({
    name: `app-${randomUUID().slice(0, 8)}`,
    workingDirectory: "/tmp/app",
  });
  const api = createProject({
    name: `api-${randomUUID().slice(0, 8)}`,
    workingDirectory: "/tmp/api",
  });
  setProjectWorkspace(app.id, workspace.id);
  setProjectWorkspace(api.id, workspace.id);
  db.prepare(
    `UPDATE projects SET lh_board_id = 'board-1', lh_board_name = 'Roadmap' WHERE id = ?`
  ).run(app.id);

  const chat = seedSession({
    projectId: app.id,
    name: "chat-one",
    view: "chat",
  });
  const now = Date.now();
  saveItem(chat, {
    id: "user-1",
    kind: "user",
    text: "Fix the login",
    createdAt: now - 3000,
  });
  saveItem(chat, {
    id: "a1",
    kind: "assistant",
    text: "Fixed it.\nTests pass.",
    createdAt: now - 2000,
  });
  saveItem(chat, { id: "t1", kind: "turn_end", createdAt: now - 1000 });
  const task = seedSession({
    projectId: api.id,
    name: "add-auth",
    task: true,
    branch: "feature/add-auth",
  });
  return { workspace, app, api, chat, task };
}

// An orchestrator session with this id, for rows that name it as started_by.
export function seedOrchestrator(id: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO sessions (id, name, tmux_name, working_directory, role)
     VALUES (?, ?, ?, '/tmp', 'orchestrator')`
  ).run(id, `orchestrator ${id}`, `claude-${id}`);
}
