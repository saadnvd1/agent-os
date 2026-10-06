export type SessionStatus = "idle" | "running" | "waiting" | "error" | "dead";

// Compact relative time for row metadata: "now", "5m", "3h", "2d", "Jun 5".
export function compactTimeAgo(date: Date, now = new Date()): string {
  const mins = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// SQLite datetime('now') strings are UTC without a zone marker.
export function fromSqliteTime(value: string): Date {
  return new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}

const STATUS: Record<SessionStatus, { label: string; tone: string }> = {
  idle: { label: "", tone: "text-muted-foreground/60" },
  running: { label: "Working", tone: "text-muted-foreground" },
  waiting: { label: "Needs input", tone: "text-amber-600 dark:text-amber-400" },
  error: { label: "Error", tone: "text-destructive" },
  dead: { label: "Stopped", tone: "text-muted-foreground/50" },
};

// What a row shows on the right. Status lives in the text, not the surface:
// only states that need a human get a word; otherwise last activity.
export function rowMeta(
  status: SessionStatus | undefined,
  lastActive: Date,
  now = new Date()
): { text: string; tone: string } {
  const s = STATUS[status ?? "dead"];
  return { text: s.label || compactTimeAgo(lastActive, now), tone: s.tone };
}

// mTerm names its sessions "mterm-<project>"; the prefix says nothing here.
export function tmuxDisplayName(name: string): string {
  return name.replace(/^mterm-/, "");
}

// ── Agent state, as mTerm shows it: a dot plus "what it's doing" ──────────

export type AgentState = "working" | "blocked" | "waiting" | "idle";

const RANK: Record<AgentState, number> = {
  idle: 0,
  working: 1,
  waiting: 2,
  blocked: 3,
};

export function busiest(a: AgentState, b: AgentState): AgentState {
  return RANK[a] >= RANK[b] ? a : b;
}

const isSpinner = (cp: number) =>
  (cp >= 0x2800 && cp <= 0x28ff) || (cp >= 0x25d0 && cp <= 0x25d3);

// Claude Code titles its terminal "⠂ <task>" while working and "✳ <task>"
// once it's your turn. Anything else isn't Claude's title.
export function stateFromTitle(title: string): AgentState | null {
  const cp = title.codePointAt(0);
  if (cp === undefined) return null;
  if (isSpinner(cp)) return "working";
  if (title.startsWith("✳")) return taskFromTitle(title) ? "waiting" : "idle";
  return null;
}

export function taskFromTitle(title: string): string | null {
  const cp = title.codePointAt(0);
  if (cp === undefined || !(isSpinner(cp) || title.startsWith("✳")))
    return null;
  const task = [...title].slice(1).join("").trim();
  return task && task !== "Claude Code" ? task : null;
}

export interface RowInfo {
  running: boolean;
  state: AgentState;
  subtitle: string | null;
}

function subtitleFor(state: AgentState, task: string | null): string | null {
  if (state === "blocked")
    return ["needs you", task].filter(Boolean).join(" · ");
  if (task) return task;
  if (state === "working") return "working";
  if (state === "waiting") return "your turn";
  return null;
}

// A session agent-os manages: the detector's status, refined by the title.
export function sessionRowInfo(
  status: SessionStatus | undefined,
  title = ""
): RowInfo {
  const running = !!status && status !== "dead";
  if (!running) return { running, state: "idle", subtitle: null };
  const fromStatus: AgentState =
    status === "running"
      ? "working"
      : status === "waiting"
        ? "waiting"
        : status === "error"
          ? "blocked"
          : "idle";
  const state = busiest(fromStatus, stateFromTitle(title) ?? "idle");
  return { running, state, subtitle: subtitleFor(state, taskFromTitle(title)) };
}

// A tmux session agent-os didn't start: Claude's title if it has one.
export function tmuxRowInfo(title: string): RowInfo {
  const state = stateFromTitle(title);
  if (state === null)
    return { running: true, state: "idle", subtitle: "shell" };
  return {
    running: true,
    state,
    subtitle: subtitleFor(state, taskFromTitle(title)),
  };
}
