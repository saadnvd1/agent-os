/**
 * What a linked machine's own AgentOS says runs there: its tmux sessions (in
 * place of `tmux list-sessions` over ssh), the sessions it manages, and their
 * state. Everything it answers is another machine's text: only the fields
 * used here are kept, checked and cleaned.
 */

import type { TmuxSessionInfo } from "../status-detector";
import { isValidTmuxName } from "./attach";
import { syncPeerMirrors } from "./peer-sync";
import {
  cleanRemoteText,
  hostApi,
  linkedHostIds,
  type HostLink,
} from "./remote-api";

export interface PeerSession {
  id: string;
  hostId: string;
  name: string;
  tmuxName: string;
  path: string;
  view: "chat" | "terminal";
  agentType: string;
  state: "running" | "waiting" | "idle" | null;
  activity: number;
  // Its row as that machine has it, for the mirror here.
  model: string;
  updatedAt: string | null;
  prUrl: string | null;
  prNumber: number | null;
  prStatus: "open" | "merged" | "closed" | null;
}

const ID = /^[A-Za-z0-9-]{1,64}$/;
const SQLITE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const PR_STATUS = new Set(["open", "merged", "closed"]);
const num = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n) ? n : 0;
const text = (s: unknown, max = 300) => cleanRemoteText(s).slice(0, max);

// The other machine's statuses run its full status pass: asked at most this often.
export const PEER_STATUS_MS = 5000;
// A reading older than this is unknown.
export const PEER_STATUS_STALE_MS = 30_000;

// One per process, like the status detector that fills it: the custom
// server and the Next.js routes each load this module.
const g = globalThis as unknown as {
  __agentosPeerSessions?: {
    managed: Map<string, PeerSession[]>;
    statuses: Map<
      string,
      { at: number; byId: Record<string, { status?: unknown }> }
    >;
  };
};
const { managed, statuses } = (g.__agentosPeerSessions ??= {
  managed: new Map(),
  statuses: new Map(),
});

/** Linked machines' managed sessions, as last listed (none once unlinked). */
export function peerManagedSessions(): PeerSession[] {
  const linked = linkedHostIds();
  return [...managed]
    .filter(([hostId]) => linked.has(hostId))
    .flatMap(([, list]) => list);
}

/** The other machine's own status for a session, as it reports it. */
export function peerStatus(
  hostId: string,
  sessionId: string,
  now = Date.now()
): PeerSession["state"] {
  // An old answer from a machine that has since stopped answering is no
  // answer: callers count unknown as busy.
  const entry = statuses.get(hostId);
  if (!entry || now - entry.at > PEER_STATUS_STALE_MS) return null;
  const s = entry.byId[sessionId]?.status;
  return s === "running" || s === "waiting" || s === "idle" ? s : null;
}

export function toTmuxInfo(
  hostId: string,
  raw: Record<string, unknown>
): TmuxSessionInfo | null {
  const name = typeof raw.name === "string" ? raw.name : "";
  if (!isValidTmuxName(name) || name.length > 200) return null;
  return {
    name,
    hostId,
    activity: num(raw.activity),
    output: num(raw.output),
    path: text(raw.path, 1000),
    attached: raw.attached === true,
    windows: num(raw.windows) || 1,
    command: text(raw.command, 100),
    title: text(raw.title),
    pid: 0,
  };
}

export function toPeerSession(
  hostId: string,
  raw: Record<string, unknown>
): PeerSession | null {
  const id = typeof raw.id === "string" ? raw.id : "";
  if (!ID.test(id)) return null;
  // That machine's mirrors of somewhere else's sessions aren't its own.
  if (raw.host_id && raw.host_id !== "local") return null;
  // Its orchestrator and its tasks belong to its own workspace and gates:
  // they're not mirrored as plain sessions here.
  if (raw.role || raw.task_prompt || raw.task_status) return null;
  const tmuxName = typeof raw.tmux_name === "string" ? raw.tmux_name : "";
  const view = raw.view === "chat" ? "chat" : "terminal";
  // A terminal is opened by its tmux name; any name it gives must be one.
  if (tmuxName && (!isValidTmuxName(tmuxName) || tmuxName.length > 200))
    return null;
  if (view === "terminal" && !tmuxName) return null;
  const updatedAt =
    typeof raw.updated_at === "string" && SQLITE_TIME.test(raw.updated_at)
      ? raw.updated_at
      : null;
  const updated = Date.parse(String(updatedAt).replace(" ", "T") + "Z");
  const prUrl =
    typeof raw.pr_url === "string" &&
    /^https:\/\/github\.com\/[^\s]{1,300}$/.test(raw.pr_url)
      ? raw.pr_url
      : null;
  return {
    id,
    hostId,
    name: text(raw.name, 200) || id,
    tmuxName,
    path: text(raw.working_directory, 1000),
    view,
    agentType: text(raw.agent_type, 40) || "claude",
    state: null,
    activity: Number.isFinite(updated) ? Math.floor(updated / 1000) : 0,
    model: text(raw.model, 100),
    updatedAt,
    prUrl,
    prNumber:
      prUrl && Number.isSafeInteger(raw.pr_number) && Number(raw.pr_number) > 0
        ? Number(raw.pr_number)
        : null,
    prStatus:
      prUrl && PR_STATUS.has(String(raw.pr_status))
        ? (raw.pr_status as PeerSession["prStatus"])
        : null,
  };
}

async function refreshStatuses(link: HostLink): Promise<void> {
  const last = statuses.get(link.hostId);
  if (last && Date.now() - last.at < PEER_STATUS_MS) return;
  const { statuses: byId } = await hostApi<{
    statuses?: Record<string, { status?: unknown }>;
  }>(link, "/api/sessions/status", { timeout: 8000 });
  statuses.set(link.hostId, { at: Date.now(), byId: byId ?? {} });
}

async function refreshManaged(link: HostLink): Promise<void> {
  const [{ sessions }] = await Promise.all([
    hostApi<{ sessions?: unknown[] }>(link, "/api/sessions", {
      timeout: 8000,
    }),
    refreshStatuses(link).catch(() => undefined),
  ]);
  const list = (Array.isArray(sessions) ? sessions : [])
    .map((s) =>
      toPeerSession(link.hostId, (s ?? {}) as Record<string, unknown>)
    )
    .filter((s): s is PeerSession => !!s)
    .map((s) => ({ ...s, state: peerStatus(link.hostId, s.id) }));
  // Listed last time and not now: it left that machine's sidebar.
  const now = new Set(list.map((s) => s.id));
  const before: PeerSession[] = managed.get(link.hostId) ?? [];
  const gone = before.map((s) => s.id).filter((id) => !now.has(id));
  managed.set(link.hostId, list);
  syncPeerMirrors(link.hostId, list, gone);
}

/**
 * A session's last screen lines, as its machine's AgentOS reads them. null
 * when they couldn't be had, or came back empty (its answer to a failure
 * too): a caller deciding on them must treat that as unknown, never as clear.
 */
export async function peerPane(
  link: HostLink,
  sessionId: string
): Promise<string[] | null> {
  try {
    const { lines } = await hostApi<{ lines?: unknown }>(
      link,
      `/api/sessions/${encodeURIComponent(sessionId)}/preview`,
      { timeout: 8000 }
    );
    const kept = (Array.isArray(lines) ? lines : [])
      .filter((l): l is string => typeof l === "string")
      .map((l) => l.slice(0, 2000))
      .slice(-200);
    return kept.some((l) => l.trim()) ? kept : null;
  } catch {
    return null;
  }
}

/**
 * The tmux sessions the other machine's AgentOS didn't start (its own
 * discovery), and, alongside, the ones it did. Its discovery lists the
 * machines it reaches too: only its own sessions are kept.
 */
export async function peerTmuxSessions(
  link: HostLink
): Promise<TmuxSessionInfo[]> {
  const [{ sessions }] = await Promise.all([
    hostApi<{ sessions?: unknown[] }>(link, "/api/tmux/discover", {
      timeout: 8000,
    }),
    // Its managed sessions keep their last listing if this one fails.
    refreshManaged(link).catch(() => undefined),
  ]);
  return (Array.isArray(sessions) ? sessions : [])
    .map((s) => (s ?? {}) as Record<string, unknown>)
    .filter((s) => !s.hostId || s.hostId === "local")
    .map((s) => toTmuxInfo(link.hostId, s))
    .filter((s): s is TmuxSessionInfo => !!s);
}
