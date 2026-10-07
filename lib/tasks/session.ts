import os from "os";
import { db, queries, type Session } from "../db";
import { getProject } from "../projects";
import { lookupPR } from "./pr-poll";
import type { TaskPR } from "./state";

export const expandHome = (p: string) => p.replace(/^~/, os.homedir());

export function taskSessions(): Session[] {
  return db
    .prepare(
      `SELECT * FROM sessions WHERE task_status IS NOT NULL ORDER BY created_at DESC`
    )
    .all() as Session[];
}

export function getTaskSession(id: string): Session {
  const session = queries.getSession(db).get(id) as Session | undefined;
  if (!session?.task_status) throw new Error("Task not found");
  return session;
}

export function projectPathFor(session: Session): string | null {
  if (!session.project_id) return null;
  const project = getProject(session.project_id);
  return project ? expandHome(project.working_directory) : null;
}

const prCache = new Map<string, { at: number; pr: TaskPR | null }>();

// strict: a gh failure throws instead of reading as "no PR".
export async function prFor(
  session: Session,
  fresh = false,
  strict = false
): Promise<TaskPR | null> {
  const repo = projectPathFor(session);
  if (!repo || !session.branch_name) return null;
  const cached = prCache.get(session.id);
  if (!fresh && cached && Date.now() - cached.at < 20000) return cached.pr;
  const pr = await lookupPR(repo, session.branch_name, { fresh, strict });
  prCache.set(session.id, { at: Date.now(), pr });
  if (pr) {
    db.prepare(
      `UPDATE sessions SET pr_url = ?, pr_number = ?, pr_status = ? WHERE id = ?`
    ).run(pr.url, pr.number, pr.state.toLowerCase(), session.id);
  }
  return pr;
}

// A finished task's PR as the database last saw it: no gh call.
export function storedPR(s: Session): TaskPR | null {
  if (!s.pr_number) return null;
  return {
    number: s.pr_number,
    url: s.pr_url ?? "",
    state:
      s.task_status === "merged" || s.pr_status === "merged"
        ? "MERGED"
        : s.pr_status === "open"
          ? "OPEN"
          : "CLOSED",
    checks: "none",
  };
}

export function forgetPR(sessionId: string): void {
  prCache.delete(sessionId);
}
