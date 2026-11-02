// What a lead's chat shows of its direction: the pins in force, the history,
// the lead's open proposals, its memo, and whether an adopted lead is still
// waiting for the owner's tap to switch over. Null for any chat that has no
// direction (Leads off, an ordinary session, Tech without leads, the chief).

import { db } from "@/lib/db";
import type { Session } from "@/lib/db/types";
import { experimentOn } from "@/lib/experiments";
import { switchPending } from "./adopt";
import {
  currentDirection,
  directionHistory,
  openProposals,
  pinDirection,
  resolveProposal,
  retirePin,
} from "./direction";
import { leadTitle } from "./home";
import { latestMemo } from "./memos";
import { CHIEF } from "./order";
import { profileFor } from "./profiles";
import { hasLeads } from "./settings";
import type { DirectionPin, LeadKind, LeadMemo, PinProposal } from "./types";

export interface LeadDirectionView {
  workspaceId: string;
  kind: LeadKind;
  title: string;
  pins: DirectionPin[];
  history: DirectionPin[];
  proposals: PinProposal[];
  memo: LeadMemo | null;
  switchPending: boolean;
}

export interface DirectionLead {
  sessionId: string;
  workspaceId: string;
  kind: LeadKind;
}

// The lead a chat belongs to, if its chat has direction.
export function directionLead(sessionId: string): DirectionLead | null {
  if (!experimentOn("leads")) return null;
  const s = db
    .prepare(
      `SELECT id, role, lead_kind, workspace_id FROM session_rows WHERE id = ?`
    )
    .get(sessionId) as
    Pick<Session, "id" | "role" | "lead_kind" | "workspace_id"> | undefined;
  if (!s?.workspace_id) return null;
  const profile = profileFor(s, hasLeads(s.workspace_id));
  // The chief has no direction of its own: it reads the leads'.
  if (!profile?.leadTools.length || profile.kind === CHIEF) return null;
  return { sessionId: s.id, workspaceId: s.workspace_id, kind: profile.kind };
}

export function directionView(sessionId: string): LeadDirectionView | null {
  const lead = directionLead(sessionId);
  if (!lead) return null;
  const { workspaceId: w, kind } = lead;
  return {
    workspaceId: w,
    kind,
    title: leadTitle(w, kind),
    pins: currentDirection(w, kind),
    history: directionHistory(w, kind, 50),
    proposals: openProposals(w, kind),
    memo: latestMemo(w, kind),
    switchPending: switchPending(sessionId),
  };
}

export type DirectionAction =
  | { action: "pin"; itemId: string }
  | { action: "unpin"; pinId: number }
  | { action: "proposal"; proposalId: number; pin: boolean };

// The owner's direction actions in a lead's chat. A pin quotes only a
// message he typed in this chat; the server copies the words.
export function applyDirection(
  sessionId: string,
  a: DirectionAction
): { error: string } | null {
  const lead = directionLead(sessionId);
  if (!lead) return { error: "This chat has no direction" };
  const { workspaceId, kind } = lead;
  switch (a.action) {
    case "pin": {
      const out = pinDirection({
        workspaceId,
        leadKind: kind,
        sessionId,
        chatItemId: a.itemId,
      });
      return "error" in out ? out : null;
    }
    case "unpin":
      return retirePin(workspaceId, kind, a.pinId)
        ? null
        : { error: "That pin isn't in force" };
    case "proposal": {
      const out = resolveProposal(workspaceId, kind, a.proposalId, a.pin);
      return out && "error" in out ? out : null;
    }
  }
}

export function parseDirectionAction(body: unknown): DirectionAction | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const id = (v: unknown) =>
    Number.isInteger(v) && (v as number) > 0 ? (v as number) : null;
  if (b.action === "pin" && typeof b.itemId === "string" && b.itemId.trim())
    return { action: "pin", itemId: b.itemId };
  if (b.action === "unpin" && id(b.pinId))
    return { action: "unpin", pinId: id(b.pinId)! };
  if (b.action === "proposal" && id(b.proposalId) && typeof b.pin === "boolean")
    return { action: "proposal", proposalId: id(b.proposalId)!, pin: b.pin };
  return null;
}
