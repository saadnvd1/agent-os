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
  active: boolean;
  sessionCount: number;
}

export interface ProjectRowInput {
  sessions: Session[]; // top-level sessions in the project
  hasWorkers: (sessionId: string) => boolean;
  tmux: TmuxSessionInfo[]; // discovered sessions in the project's folder
  statuses: Record<
    string,
    { status: SessionStatus; title?: string } | undefined
  >;
  activeSessionId?: string;
}

// One row per project, as mTerm draws it: the busiest state among its
// sessions and what it's doing. A project with one session IS that session.
export function projectRow(input: ProjectRowInput): ProjectRowModel {
  const rows = [
    ...input.sessions.map((s) => ({
      target: { kind: "session", id: s.id } as RowTarget,
      info: sessionRowInfo(
        input.statuses[s.id]?.status,
        input.statuses[s.id]?.title
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
    active: input.sessions.some((s) => s.id === input.activeSessionId),
    sessionCount: rows.length,
  };
}
