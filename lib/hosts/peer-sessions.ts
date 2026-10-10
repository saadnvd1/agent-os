/**
 * What a linked machine's own AgentOS says runs there: its tmux sessions (in
 * place of `tmux list-sessions` over ssh), the sessions it manages, and their
 * state. Everything it answers is another machine's text: only the fields
 * used here are kept, checked and cleaned.
 */

import type { TmuxSessionInfo } from "../status-detector";
import { isValidTmuxName } from "./attach";
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
}

const ID = /^[A-Za-z0-9-]{1,64}$/;
const num = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n) ? n : 0;
const text = (s: unknown, max = 300) => cleanRemoteText(s).slice(0, max);

// The other machine's statuses run its full status pass: asked at most this often.
export const PEER_STATUS_MS = 5000;

const managed = new Map<string, PeerSession[]>();
const statuses = new Map<
  string,
  { at: number; byId: Record<string, { status?: unknown }> }
>();

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
  sessionId: string
): PeerSession["state"] {
  const s = statuses.get(hostId)?.byId[sessionId]?.status;
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
  const tmuxName = typeof raw.tmux_name === "string" ? raw.tmux_name : "";
  const view = raw.view === "chat" ? "chat" : "terminal";
  // A terminal is opened by its tmux name.
  if (view === "terminal" && !isValidTmuxName(tmuxName)) return null;
  const updated = Date.parse(
    String(raw.updated_at ?? "").replace(" ", "T") + "Z"
  );
  return {
    id,
    hostId,
    name: text(raw.name, 200) || id,
    tmuxName: isValidTmuxName(tmuxName) ? tmuxName : "",
    path: text(raw.working_directory, 1000),
    view,
    agentType: text(raw.agent_type, 40) || "claude",
    state: null,
    activity: Number.isFinite(updated) ? Math.floor(updated / 1000) : 0,
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
  const { sessions } = await hostApi<{ sessions?: unknown[] }>(
    link,
    "/api/sessions",
    { timeout: 8000 }
  );
  await refreshStatuses(link).catch(() => undefined);
  managed.set(
    link.hostId,
    (Array.isArray(sessions) ? sessions : [])
      .map((s) =>
        toPeerSession(link.hostId, (s ?? {}) as Record<string, unknown>)
      )
      .filter((s): s is PeerSession => !!s)
      .map((s) => ({ ...s, state: peerStatus(link.hostId, s.id) }))
  );
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
