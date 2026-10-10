// The sidebar's one flat list, sorted onto shelves: Pinned, Needs you,
// Working, then Done. Client-safe: no database.
import type { Session } from "@/lib/db/types";
import type { TaskState } from "@/lib/tasks/state";

// Why a session is blocked on you.
export type SessionNeed =
  | "approve"
  | "answer"
  | "signin"
  | "input"
  | "unsent"
  | "failed";

export const NEED_LABEL: Record<SessionNeed, string> = {
  approve: "Approve",
  answer: "Answer",
  signin: "Sign in",
  input: "Input",
  unsent: "Unsent",
  failed: "Failed",
};

export const DONE_FIRST_PAGE = 10;
export const DONE_PAGE = 25;

export interface RowStatus {
  status?: string;
  need?: SessionNeed | null;
  unread?: boolean;
  asks?: number;
  // A program's own message (OSC 7501): untrusted, plain text only.
  detail?: string | null;
}

export interface SidebarRow {
  session: Session;
  status: RowStatus | undefined;
  need: SessionNeed | null;
  unread: boolean;
  working: boolean;
  // Orchestration workers, nested under their conductor.
  workers: SidebarRow[];
}

export interface Shelves {
  pinned: SidebarRow[];
  needsYou: SidebarRow[];
  working: SidebarRow[];
  done: SidebarRow[];
}

export function taskNeed(state: TaskState | undefined): SessionNeed | null {
  if (state === "checks-failing" || state === "exited") return "failed";
  if (state === "blocked") return "answer";
  return null;
}

// An approval or a question beats what the task says; a terminal waiting
// for input or an errored chat only counts when the task has nothing.
export function needOf(
  session: Pick<Session, "worker_status">,
  status: RowStatus | undefined,
  task: TaskState | undefined
): SessionNeed | null {
  const live = status?.need ?? null;
  if (live === "approve" || live === "answer" || live === "signin") return live;
  return (
    taskNeed(task) ??
    live ??
    (session.worker_status === "failed" ? "failed" : null)
  );
}

export function matchesQuery(
  session: Pick<Session, "name">,
  projectName: string,
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    session.name.toLowerCase().includes(q) ||
    projectName.toLowerCase().includes(q)
  );
}

export interface ShelfInput {
  sessions: Session[];
  statuses: Record<string, RowStatus | undefined>;
  tasks: Record<string, TaskState | undefined>;
  projectName: (session: Session) => string;
  query?: string;
  projectId?: string | null;
}

const newestFirst = (a: SidebarRow, b: SidebarRow) =>
  b.session.updated_at.localeCompare(a.session.updated_at);
const oldestFirst = (a: SidebarRow, b: SidebarRow) =>
  a.session.created_at.localeCompare(b.session.created_at);

function toRow(input: ShelfInput, session: Session): SidebarRow {
  const status = input.statuses[session.id];
  return {
    session,
    status,
    need: needOf(session, status, input.tasks[session.id]),
    unread: !!status?.unread,
    working: status?.status === "running",
    workers: [],
  };
}

export function buildShelves(input: ShelfInput): Shelves {
  const rows = input.sessions
    .filter(
      (s) =>
        !s.archived_at &&
        (!input.projectId || s.project_id === input.projectId) &&
        matchesQuery(s, input.projectName(s), input.query ?? "")
    )
    .map((s) => toRow(input, s));
  const byId = new Map(rows.map((r) => [r.session.id, r]));

  const top: SidebarRow[] = [];
  for (const row of rows) {
    const conductor = row.session.conductor_session_id
      ? byId.get(row.session.conductor_session_id)
      : undefined;
    // A worker that needs you leaves its conductor so the shelf shows it.
    if (conductor && !row.need) conductor.workers.push(row);
    else top.push(row);
  }

  const shelves: Shelves = { pinned: [], needsYou: [], working: [], done: [] };
  for (const row of top) {
    if (row.session.pinned) shelves.pinned.push(row);
    else if (row.need) shelves.needsYou.push(row);
    else if (row.working) shelves.working.push(row);
    else shelves.done.push(row);
  }
  shelves.pinned.sort(oldestFirst);
  shelves.needsYou.sort(newestFirst);
  shelves.working.sort(newestFirst);
  shelves.done.sort(newestFirst);
  return shelves;
}

// Done shows 10 at first, then 25 more per "Show more".
export const doneLimit = (pages: number) =>
  DONE_FIRST_PAGE + Math.max(0, pages) * DONE_PAGE;

// A workspace holds its projects' sessions and its own orchestrator; no
// workspace selected means every session.
export function inWorkspace(
  session: Pick<Session, "project_id" | "workspace_id" | "role">,
  workspaceOf: (projectId: string) => string | null | undefined,
  workspaceId: string | null
): boolean {
  if (!workspaceId) return true;
  if (session.role === "orchestrator")
    return session.workspace_id === workspaceId;
  return (
    !!session.project_id && workspaceOf(session.project_id) === workspaceId
  );
}

// A workspace's projects, or every project when none is selected.
export function projectsInWorkspace<P extends { workspace_id?: string | null }>(
  projects: P[],
  workspaceId: string | null
): P[] {
  return workspaceId
    ? projects.filter((p) => p.workspace_id === workspaceId)
    : projects;
}

// Whether a row would draw the same: statuses are rebuilt on every push, so
// rows compare by what they show rather than by identity.
export function sameRow(a: SidebarRow, b: SidebarRow): boolean {
  if (a === b) return true;
  return (
    a.session === b.session &&
    a.need === b.need &&
    a.unread === b.unread &&
    a.working === b.working &&
    sameStatus(a.status, b.status) &&
    a.workers.length === b.workers.length &&
    a.workers.every((w, i) => sameRow(w, b.workers[i]))
  );
}

function sameStatus(a: RowStatus | undefined, b: RowStatus | undefined) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.status === b.status &&
    (a.need ?? null) === (b.need ?? null) &&
    !!a.unread === !!b.unread &&
    a.asks === b.asks &&
    (a.detail ?? null) === (b.detail ?? null)
  );
}
