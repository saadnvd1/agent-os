/**
 * Each workspace's standing orchestrator: one durable chat session that runs
 * the work across the workspace's projects (docs/plans: workspace
 * orchestrator). It's made on first open and never swept with idle sessions.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { db, type Session } from "../db";
import { resolveModelForAgent } from "../model-catalog";
import { getWorkspace } from "../workspaces";

// It works through tools, not in a repo: a scratch folder of its own.
export const orchestratorDir = (workspaceId: string) =>
  path.join(os.homedir(), ".agent-os", "orchestrators", workspaceId);

export function getOrchestrator(workspaceId: string): Session | null {
  return (
    (db
      .prepare(
        `SELECT * FROM sessions WHERE role = 'orchestrator' AND workspace_id = ?`
      )
      .get(workspaceId) as Session | undefined) ?? null
  );
}

export function listOrchestrators(): Session[] {
  return db
    .prepare(`SELECT * FROM sessions WHERE role = 'orchestrator'`)
    .all() as Session[];
}

export function isOrchestrator(sessionId: string): boolean {
  const row = db
    .prepare(`SELECT role FROM sessions WHERE id = ?`)
    .get(sessionId) as { role: string | null } | undefined;
  return row?.role === "orchestrator";
}

// The workspace's orchestrator, made the first time it's opened. Opening it
// twice at once still makes one: the unique index decides.
export function ensureOrchestrator(workspaceId: string): Session {
  const existing = getOrchestrator(workspaceId);
  if (existing) return existing;
  const workspace = getWorkspace(workspaceId);
  if (!workspace) throw new Error("Unknown workspace");

  const dir = orchestratorDir(workspaceId);
  fs.mkdirSync(dir, { recursive: true });
  const id = randomUUID();
  db.prepare(
    `INSERT OR IGNORE INTO sessions (id, name, tmux_name, working_directory, model,
       group_path, agent_type, auto_approve, project_id, host_id, view, chat_access,
       role, workspace_id)
     VALUES (?, ?, ?, ?, ?, 'sessions', 'claude', 0, NULL, 'local', 'chat', 'ask',
       'orchestrator', ?)`
  ).run(
    id,
    `${workspace.name} orchestrator`,
    `claude-${id}`,
    dir,
    resolveModelForAgent("claude", null),
    workspaceId
  );
  return getOrchestrator(workspaceId)!;
}

// The secret its worker sends with each tool call, so no other local
// process can act as the orchestrator. Made on first use.
export function orchestratorToken(workspaceId: string): string {
  const o = getOrchestrator(workspaceId);
  if (!o) throw new Error("This workspace has no orchestrator");
  if (o.orch_token) return o.orch_token;
  const token = randomBytes(32).toString("hex");
  db.prepare(
    `UPDATE sessions SET orch_token = COALESCE(orch_token, ?) WHERE id = ?`
  ).run(token, o.id);
  return getOrchestrator(workspaceId)!.orch_token!;
}

export function isOrchestratorToken(
  workspaceId: string,
  token: string | null
): boolean {
  const want = getOrchestrator(workspaceId)?.orch_token;
  if (!want || !token) return false;
  const a = Buffer.from(want);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Why a session can't be deleted on its own, or null. An orchestrator goes
// only with its workspace.
export function deletionRefusal(session: Pick<Session, "role">): string | null {
  return session.role === "orchestrator"
    ? "A workspace's orchestrator can't be deleted; it goes with its workspace"
    : null;
}
