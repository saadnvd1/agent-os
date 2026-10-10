/**
 * Where a task can be moved from where it is now: out to each linked machine,
 * or back here from one. Client-safe (no db), so every menu offers the same
 * list. The server still decides (lib/tasks/move-flow.ts); this only keeps
 * offers it would refuse out of the menus.
 */

// Moving carries a terminal's branch and conversation; a chat's worker,
// transcript and queue don't follow it yet.
// Switching views runs where the task does, so the advice is only for here.
export const CHAT_MOVE_REFUSAL =
  "Chat tasks can't move yet. Switch it to Terminal to move it.";
export const CHAT_MOVE_REFUSAL_AWAY = "Chat tasks can't move yet.";
const chatRefusal = (hostId: string | null) =>
  isHere(hostId) ? CHAT_MOVE_REFUSAL : CHAT_MOVE_REFUSAL_AWAY;

export const viewOf = (s: { view?: string | null }): "chat" | "terminal" =>
  s.view === "chat" ? "chat" : "terminal";

export interface Movable {
  // The machine it runs on; null or "local" for this one.
  hostId: string | null;
  // Running or stuck moving: nothing else can move.
  live: boolean;
  moving: boolean;
  // Where a move that stopped partway was going (a machine's name).
  movedTo: string | null;
  branch: string | null;
  // Card and orchestrator tasks stay on this machine for now.
  pinnedHere: boolean;
  // Why its moves are offered but can't be taken (shown, disabled).
  blocked: string | null;
}

export interface MoveTarget {
  hostId: string;
  name: string;
  label: string;
  // Offered, but disabled for this reason.
  blocked?: string;
}

export interface LinkedMachine {
  id: string;
  name: string;
}

const isHere = (hostId: string | null) => !hostId || hostId === "local";

export function moveTargets(m: Movable, linked: LinkedMachine[]): MoveTarget[] {
  const targets = offered(m, linked);
  return m.blocked
    ? targets.map((t) => ({ ...t, blocked: m.blocked! }))
    : targets;
}

function offered(m: Movable, linked: LinkedMachine[]): MoveTarget[] {
  if (!m.live || !m.branch || m.pinnedHere) return [];
  if (!isHere(m.hostId))
    return [
      {
        hostId: "local",
        name: "this machine",
        label: "Move back to this machine",
      },
    ];
  // Partway to one machine: finishing it is the only move the server allows.
  if (m.moving && m.movedTo) {
    const to = linked.find((h) => h.name === m.movedTo);
    return to
      ? [{ hostId: to.id, name: to.name, label: `Finish moving to ${to.name}` }]
      : [];
  }
  return linked.map((h) => ({
    hostId: h.id,
    name: h.name,
    label: `Move to ${h.name}`,
  }));
}

const LIVE = new Set(["running", "moving"]);

export function movableSession(s: {
  host_id: string | null;
  task_status: string | null;
  moved_to: string | null;
  branch_name: string | null;
  lh_card_id: string | null;
  role: string | null;
  view?: string | null;
}): Movable {
  return {
    hostId: s.host_id,
    live: LIVE.has(s.task_status ?? ""),
    moving: s.task_status === "moving",
    movedTo: s.moved_to,
    branch: s.branch_name,
    pinnedHere: !!s.lh_card_id || !!s.role,
    blocked: viewOf(s) === "chat" ? chatRefusal(s.host_id) : null,
  };
}

const ENDED = new Set(["merged", "dropped", "done"]);

export function movableTask(t: {
  hostId: string | null;
  state: string;
  branch: string | null;
  cardUrl: string | null;
  view?: string | null;
}): Movable {
  return {
    hostId: t.hostId,
    live: !ENDED.has(t.state),
    moving: t.state === "moving",
    movedTo: null,
    branch: t.branch,
    pinnedHere: !!t.cardUrl,
    blocked: viewOf(t) === "chat" ? chatRefusal(t.hostId) : null,
  };
}
