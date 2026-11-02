// What the pinned orchestrator row says: its state with the workspace's
// running and in-review counts, and Saad's open asks. Client-safe. Queued
// tasks make it Waiting but aren't counted: the line has room for the asks.
// With Leads on, a workspace's chief and leads are rows of the same kind,
// one card each (its team).
import type {
  OrchestratorOverview,
  TeamMemberView,
} from "../orchestrator/ask-view";
import { BUILT_IN_KINDS, TECH } from "../leads/types";
import { CHIEF, leadRank, memberLetter } from "../leads/order";
import type { SidebarRow } from "./shelves";

export interface OrchestratorRowCounts {
  asks: number;
  paused: boolean;
  running: number;
  inReview: number;
  queued: number;
}

export type OrchestratorState =
  "Paused" | "Failed" | "Working" | "Replied" | "Waiting" | "Idle";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

// Working is mid-turn; Replied, a reply Saad hasn't seen; Waiting, idle
// while the workspace still has work in flight; Idle, nothing at all.
export function orchestratorState(
  row: Pick<SidebarRow, "need" | "working" | "unread">,
  c: OrchestratorRowCounts
): OrchestratorState {
  if (c.paused) return "Paused";
  if (row.need === "failed") return "Failed";
  if (row.working) return "Working";
  if (row.unread) return "Replied";
  if (c.running + c.inReview + c.queued > 0) return "Waiting";
  return "Idle";
}

export function orchestratorRowText(
  row: Pick<SidebarRow, "need" | "working" | "unread">,
  c: OrchestratorRowCounts
): { state: OrchestratorState; status: string; asks: string | null } {
  const state = orchestratorState(row, c);
  const status = [
    state,
    c.running > 0 && `${c.running} running`,
    c.inReview > 0 && `${c.inReview} in review`,
  ]
    .filter(Boolean)
    .join(" · ");
  return { state, status, asks: c.asks > 0 ? plural(c.asks, "ask") : null };
}

// The workspaces shown that have no orchestrator yet, each offered as a
// "Start orchestrator" row. One that exists but was unpinned isn't missing.
// Like the orchestrator row, none show under a chosen project.
export function orchestratorsToStart(
  overviews: readonly { workspaceId: string; sessionId: string | null }[],
  scope: {
    workspaces: readonly { id: string; name: string }[];
    workspaceId: string | null;
    projectId: string | null;
    query: string;
  }
): { workspaceId: string; name: string }[] {
  if (scope.projectId) return [];
  const q = scope.query.trim().toLowerCase();
  const missing = new Set(
    overviews.filter((o) => !o.sessionId).map((o) => o.workspaceId)
  );
  return scope.workspaces
    .filter(
      (w) =>
        missing.has(w.id) &&
        (!scope.workspaceId || w.id === scope.workspaceId) &&
        (!q || `${w.name} orchestrator`.toLowerCase().includes(q))
    )
    .map((w) => ({ workspaceId: w.id, name: w.name }));
}

export interface TeamMember extends TeamMemberView {
  workspaceId: string;
  // Its place in the team: chief, Tech, Marketing, Product, then custom.
  rank: number;
  // What its avatar says: C, T, M, P, or a custom kind's first letter.
  letter: string;
}

// Session id -> the chief or lead it is, for every workspace showing a team.
// Empty while Leads is off, so every row draws as before leads.
export function teamMembers(
  overviews: readonly Pick<OrchestratorOverview, "workspaceId" | "team">[]
): Map<string, TeamMember> {
  const members = new Map<string, TeamMember>();
  for (const o of overviews)
    for (const m of o.team ?? [])
      members.set(m.sessionId, {
        ...m,
        workspaceId: o.workspaceId,
        rank: leadRank(m.kind),
        letter: memberLetter(m.kind),
      });
  return members;
}

// A team card's counts. Tech carries the workspace's work and its own asks;
// another lead only its own asks; the chief heads no department, so none.
export function memberCounts(
  member: Pick<TeamMember, "kind">,
  overview:
    Pick<OrchestratorOverview, "asks" | "paused" | "inReview"> | undefined,
  workspace: { running: number; queued: number }
): OrchestratorRowCounts {
  const tech = member.kind === TECH;
  return {
    asks:
      member.kind === CHIEF
        ? 0
        : (overview?.asks.filter((a) => a.leadKind === member.kind).length ??
          0),
    paused: !!overview?.paused,
    running: tech ? workspace.running : 0,
    inReview: tech ? (overview?.inReview ?? 0) : 0,
    queued: tech ? workspace.queued : 0,
  };
}

export type MemberDot = "failed" | "asks" | "working" | "replied" | "idle";

// The dot on a member's avatar, by what matters most.
export function memberDot(
  row: Pick<SidebarRow, "need" | "working" | "unread">,
  asks: number
): MemberDot {
  if (row.need === "failed") return "failed";
  if (asks > 0 || row.need) return "asks";
  if (row.working) return "working";
  if (row.unread) return "replied";
  return "idle";
}

// A team folded into one row under All workspaces: what needs you, then the
// workspace's work, else the busiest member's state.
export function teamRowText(
  rows: readonly Pick<SidebarRow, "need" | "working" | "unread">[],
  c: OrchestratorRowCounts
): { needs: string | null; status: string } {
  const work = [
    c.running > 0 && `${c.running} running`,
    c.inReview > 0 && `${c.inReview} in review`,
  ].filter(Boolean);
  const state = c.paused
    ? "Paused"
    : rows.some((r) => r.working)
      ? "Working"
      : rows.some((r) => r.unread)
        ? "Replied"
        : "Idle";
  return {
    needs: c.asks > 0 ? `${c.asks} needs you` : null,
    status: (work.length && !c.paused ? work : [state, ...work]).join(" · "),
  };
}

// An idle member's line when there's nothing else to say: the chief is
// quiet, and a new lead has no direction to work from yet.
export function memberIdleText(
  member: Pick<TeamMember, "kind" | "pins">,
  state: OrchestratorState,
  asks: number
): string | null {
  if (state !== "Idle" || asks > 0) return null;
  if (member.kind === CHIEF) return "Nothing needs you · all quiet";
  if (member.kind !== TECH && member.pins === 0)
    return "New · no direction yet";
  return null;
}

// The shipped leads each team doesn't have yet, offered as dashed "Add lead"
// rows under it.
export function addableKinds(
  team: ReadonlyMap<string, Pick<TeamMember, "workspaceId" | "kind">>
): Map<string, string[]> {
  const has = new Map<string, Set<string>>();
  for (const m of team.values())
    has.set(m.workspaceId, (has.get(m.workspaceId) ?? new Set()).add(m.kind));
  const out = new Map<string, string[]>();
  for (const [ws, kinds] of has) {
    const missing = BUILT_IN_KINDS.filter((k) => !kinds.has(k));
    if (missing.length) out.set(ws, missing);
  }
  return out;
}

export type HeadItem =
  | { kind: "row"; row: SidebarRow }
  | { kind: "label"; workspaceId: string }
  | { kind: "team"; workspaceId: string; rows: SidebarRow[] }
  | { kind: "add"; workspaceId: string; leadKind: string };

// What the top of the list draws from the pinned heads (already in team
// order). A workspace without a team keeps its one card. A team gets a label
// and a card per member, then a dashed row per lead it could add; folded
// under All workspaces, one row.
export function headItems(
  rows: readonly SidebarRow[],
  team: ReadonlyMap<string, { workspaceId: string }>,
  fold: boolean,
  addable: ReadonlyMap<string, readonly string[]> = new Map()
): HeadItem[] {
  const items: HeadItem[] = [];
  const teams = new Map<string, SidebarRow[]>();
  for (const row of rows) {
    const ws = team.get(row.session.id)?.workspaceId;
    if (ws === undefined) {
      items.push({ kind: "row", row });
      continue;
    }
    const known = teams.get(ws);
    if (!known) {
      teams.set(ws, [row]);
      items.push(
        fold
          ? { kind: "team", workspaceId: ws, rows: teams.get(ws)! }
          : { kind: "label", workspaceId: ws }
      );
    } else known.push(row);
    if (!fold) items.push({ kind: "row", row });
  }
  if (fold) return items;
  return items.flatMap((item, i) => {
    const ws =
      item.kind === "row"
        ? team.get(item.row.session.id)?.workspaceId
        : undefined;
    const next = items[i + 1];
    const last =
      ws !== undefined &&
      !(
        next?.kind === "row" &&
        team.get(next.row.session.id)?.workspaceId === ws
      );
    return last
      ? [
          item,
          ...(addable.get(ws) ?? []).map((leadKind): HeadItem => ({
            kind: "add",
            workspaceId: ws,
            leadKind,
          })),
        ]
      : [item];
  });
}
