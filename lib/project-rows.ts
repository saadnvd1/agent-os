import type { Session } from "./db";
import type { TmuxSessionInfo } from "./status-detector";
import {
  busiest,
  sessionRowInfo,
  tmuxRowInfo,
  type AgentState,
  type SessionStatus,
} from "./session-meta";

export type RowTarget =
  | { kind: "session"; id: string }
  | { kind: "tmux"; name: string; hostId: string };

export interface ProjectRowModel {
  running: boolean;
  state: AgentState;
  subtitle: string | null;
  // The project's only session: the row opens it instead of expanding.
  single: RowTarget | null;
  // What a click on the row opens: the most recently used session, else the
  // most recently active discovered tmux session. Null means start one.
  latest: RowTarget | null;
  active: boolean;
  // Created recently: shown even before it has ever run.
  fresh: boolean;
  sessionCount: number;
}

export interface ProjectRowInput {
  sessions: Session[]; // top-level sessions in the project
  hasWorkers: (sessionId: string) => boolean;
  tmux: TmuxSessionInfo[]; // discovered sessions in the project's folder
  statuses: Record<
    string,
    { status: SessionStatus; title?: string; task?: string | null } | undefined
  >;
  activeSessionId?: string;
  now?: number;
}

const FRESH_MS = 24 * 60 * 60 * 1000;

// SQLite's datetime('now') is UTC without a zone marker.
const sqliteTime = (t: string | undefined) =>
  Date.parse(`${t?.replace(" ", "T")}Z`) || 0;
const createdAt = (s: Session) => sqliteTime(s.created_at);

function latestTarget(input: ProjectRowInput): RowTarget | null {
  const session = [...input.sessions].sort(
    (a, b) => sqliteTime(b.updated_at) - sqliteTime(a.updated_at)
  )[0];
  if (session) return { kind: "session", id: session.id };
  const tmux = input.tmux[0]; // discovered sessions come most active first
  return tmux ? { kind: "tmux", name: tmux.name, hostId: tmux.hostId } : null;
}

// One row per project: the busiest state among its
// sessions and what it's doing. A project with one session IS that session.
export function projectRow(input: ProjectRowInput): ProjectRowModel {
  const rows = [
    ...input.sessions.map((s) => ({
      target: { kind: "session", id: s.id } as RowTarget,
      info: sessionRowInfo(
        input.statuses[s.id]?.status,
        input.statuses[s.id]?.title,
        input.statuses[s.id]?.task
      ),
      nested: input.hasWorkers(s.id),
    })),
    ...input.tmux.map((t) => ({
      target: { kind: "tmux", name: t.name, hostId: t.hostId } as RowTarget,
      info: tmuxRowInfo(t.title),
      nested: false,
    })),
  ];
  const live = rows.filter((r) => r.info.running);
  const state = rows.reduce<AgentState>(
    (acc, r) => busiest(acc, r.info.state),
    "idle"
  );
  const only = rows.length === 1 && !rows[0].nested ? rows[0] : null;
  const subtitle =
    live.length > 1
      ? `${live.length} sessions`
      : (live[0]?.info.subtitle ?? null);

  return {
    running: live.length > 0,
    state,
    subtitle,
    single: only?.target ?? null,
    latest: only?.target ?? latestTarget(input),
    active: input.sessions.some((s) => s.id === input.activeSessionId),
    fresh: input.sessions.some(
      (s) => (input.now ?? Date.now()) - createdAt(s) < FRESH_MS
    ),
    sessionCount: rows.length,
  };
}
