// Test fixtures: a workspace with two projects and a few sessions in the
// test database.

import { randomUUID } from "crypto";
import { db } from "../db";
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
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, project_id, view,
       task_status, branch_name, updated_at)
     VALUES (?, ?, ?, '/tmp', ?, ?, ?, ?, COALESCE(?, datetime('now')))`
  ).run(
    id,
    opts.name,
    `claude-${id}`,
    opts.projectId,
    opts.view ?? "terminal",
    opts.task ? "running" : null,
    opts.branch ?? null,
    opts.updatedAt ?? null
  );
  return id;
}

export function seedWorkspace(name = `ws-${randomUUID().slice(0, 6)}`) {
  const workspace = createWorkspace(name);
  const app = createProject({
    name: `app-${randomUUID().slice(0, 4)}`,
    workingDirectory: "/tmp/app",
  });
  const api = createProject({
    name: `api-${randomUUID().slice(0, 4)}`,
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
