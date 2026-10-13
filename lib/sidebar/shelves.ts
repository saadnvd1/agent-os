// The sidebar's one flat list, sorted onto shelves: the workspace's pinned
// orchestrator, Pinned, Needs you, Working, In review, then Done. Client-safe: no database.
import type { Session } from "@/lib/db/types";
import { fromSqliteTime } from "@/lib/session-meta";
import type { PrStage } from "@/lib/tasks/pr-stage";
import { isFinished, type TaskState } from "@/lib/tasks/state";

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
  stalled?: boolean;
  // A chat summarising its context (status stays "running").
  compacting?: { since: number; before?: number };
  // Background commands, subagents and monitors still running.
  background?: number;
  asks?: number;
  prStage?: PrStage;
  // A program's own message (OSC 7501): untrusted, plain text only.
  detail?: string | null;
}

export interface SidebarRow {
  session: Session;
  status: RowStatus | undefined;
  need: SessionNeed | null;
  unread: boolean;
  working: boolean;
  // Working, but summarising its context, not on the task.
  compacting?: boolean;
  // Orchestration workers, nested under their conductor.
  workers: SidebarRow[];
  // Its task's state, when it's a task.
  task?: TaskState;
  // An orchestrator's quick changes (orchestrator/quick.ts), nested under it.
  quick?: SidebarRow[];
}

export interface Shelves {
  // Each shown workspace's current orchestrator, while it's pinned.
  orchestrators: SidebarRow[];
  pinned: SidebarRow[];
  needsYou: SidebarRow[];
  working: SidebarRow[];
  inReview: SidebarRow[];
  done: SidebarRow[];
}

export function taskNeed(state: TaskState | undefined): SessionNeed | null {
  if (state === "checks-failing" || state === "exited") return "failed";
  if (state === "blocked") return "answer";
  return null;
}

// Where a row that needs nothing and isn't running goes: an open PR or a plan
// waiting on approval is in review, any other unfinished task is mid-job, and
// only finished work or a plain idle session is done.
export function quietShelf(
  task: TaskState | undefined
): "inReview" | "working" | "done" {
  if (task === "review" || task === "plan-ready") return "inReview";
  if (!task || isFinished(task)) return "done";
  return "working";
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
  // Each workspace's current orchestrator (its overview's sessionId). Any
  // other orchestrator session is an ordinary row, pinned or not.
  currentOrchestrators?: ReadonlySet<string>;
  // Only the sessions this orchestrator session started.
  startedBy?: string | null;
}

const newestFirst = (a: SidebarRow, b: SidebarRow) =>
  b.session.updated_at.localeCompare(a.session.updated_at);
const oldestFirst = (a: SidebarRow, b: SidebarRow) =>
  a.session.created_at.localeCompare(b.session.created_at);

const OPEN_RUN = ["queued", "starting", "running"];

// A recipe run that hasn't reported its result yet: its session going quiet
// between turns (an EAS build running in the background, say) isn't it ending.
// The list query carries the run as JSON.
export function recipeRunOpen(session: Pick<Session, "recipe_run">): boolean {
  if (!session.recipe_run) return false;
  try {
    return OPEN_RUN.includes(JSON.parse(session.recipe_run)?.status);
  } catch {
    return false;
  }
}

function toRow(input: ShelfInput, session: Session): SidebarRow {
  const status = input.statuses[session.id];
  return {
    session,
    status,
    need: needOf(session, status, input.tasks[session.id]),
    unread: !!status?.unread,
    working:
      status?.status === "running" ||
      (status?.background ?? 0) > 0 ||
      recipeRunOpen(session),
    compacting: !!status?.compacting,
    workers: [],
    task: input.tasks[session.id],
    quick: [],
  };
}

export function buildShelves(input: ShelfInput): Shelves {
  const rows = input.sessions
    .filter(
      (s) =>
        !s.archived_at &&
        (!input.projectId || s.project_id === input.projectId) &&
        (!input.startedBy || s.started_by === input.startedBy) &&
        matchesQuery(s, input.projectName(s), input.query ?? "")
    )
    .map((s) => toRow(input, s));
  const byId = new Map(rows.map((r) => [r.session.id, r]));

  const top: SidebarRow[] = [];
  for (const row of rows) {
    // A quick change always sits under the orchestrator that makes it: it's
    // that orchestrator's to carry, never one that needs you.
    const owner = row.session.quick_of
      ? byId.get(row.session.quick_of)
      : undefined;
    if (owner) {
      (owner.quick ??= []).push(row);
      continue;
    }
    const conductor = row.session.conductor_session_id
      ? byId.get(row.session.conductor_session_id)
      : undefined;
    // A worker that needs you leaves its conductor so the shelf shows it.
    if (conductor && !row.need) conductor.workers.push(row);
    else top.push(row);
  }

  const shelves: Shelves = {
    orchestrators: [],
    pinned: [],
    needsYou: [],
    working: [],
    inReview: [],
    done: [],
  };
  for (const row of top) {
    const { pinned, role, id } = row.session;
    const current = !!input.currentOrchestrators?.has(id);
    if (pinned && current) shelves.orchestrators.push(row);
    else if (pinned && role !== "orchestrator") shelves.pinned.push(row);
    else if (row.need) shelves.needsYou.push(row);
    else if (row.working) shelves.working.push(row);
    else shelves[quietShelf(row.task)].push(row);
  }
  shelves.orchestrators.sort(oldestFirst);
  shelves.pinned.sort(oldestFirst);
  shelves.needsYou.sort(newestFirst);
  shelves.working.sort(newestFirst);
  shelves.inReview.sort(newestFirst);
  shelves.done.sort(newestFirst);
  return shelves;
}

// Done shows 10 at first, then 25 more per "Show more".
export const doneLimit = (pages: number) =>
  DONE_FIRST_PAGE + Math.max(0, pages) * DONE_PAGE;

// What a folded Done shelf says: how many finished today (local time), and
// how many before.
export function doneSummary(
  done: readonly SidebarRow[],
  now: Date = new Date()
): { today: number; earlier: number; text: string } {
  const day = now.toDateString();
  const today = done.filter(
    (r) => fromSqliteTime(r.session.updated_at).toDateString() === day
  ).length;
  const earlier = done.length - today;
  const text = [
    today > 0 && `${today} done today`,
    earlier > 0 && `${earlier} earlier`,
  ]
    .filter(Boolean)
    .join(" · ");
  return { today, earlier, text };
}

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
    a.task === b.task &&
    a.workers.length === b.workers.length &&
    a.workers.every((w, i) => sameRow(w, b.workers[i])) &&
    (a.quick?.length ?? 0) === (b.quick?.length ?? 0) &&
    (a.quick ?? []).every((q, i) => sameRow(q, b.quick![i]))
  );
}

function sameStatus(a: RowStatus | undefined, b: RowStatus | undefined) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.status === b.status &&
    (a.need ?? null) === (b.need ?? null) &&
    !!a.unread === !!b.unread &&
    !!a.stalled === !!b.stalled &&
    (a.compacting?.since ?? null) === (b.compacting?.since ?? null) &&
    (a.compacting?.before ?? null) === (b.compacting?.before ?? null) &&
    (a.background ?? 0) === (b.background ?? 0) &&
    a.asks === b.asks &&
    (a.prStage?.stage ?? null) === (b.prStage?.stage ?? null) &&
    (a.prStage?.number ?? null) === (b.prStage?.number ?? null) &&
    (a.prStage?.sha ?? null) === (b.prStage?.sha ?? null) &&
    (a.detail ?? null) === (b.detail ?? null)
  );
}
