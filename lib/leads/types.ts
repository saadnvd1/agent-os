// A lead's department: the shipped kinds, or a custom slug.
export type LeadKind = string;

export const TECH: LeadKind = "tech";
export const BUILT_IN_KINDS = ["tech", "marketing", "product"] as const;

// How far a workspace's chief of staff may go without being asked. V1 acts
// only on request; its sweep reads and raises asks.
export type ChiefAutonomy = "on_request" | "acts";

export interface WorkspaceLeads {
  workspaceId: string;
  enabledAt: string;
  chiefAutonomy: ChiefAutonomy;
}

export interface LeadCharter {
  workspaceId: string;
  leadKind: LeadKind;
  title: string;
  areaText: string;
  charterMd: string;
  goal: string;
  updatedAt: string;
}

export type LeadAreaKind = "project" | "path" | "board";

export interface LeadArea {
  kind: LeadAreaKind;
  value: string;
}

export interface DirectionPin {
  id: number;
  workspaceId: string;
  leadKind: LeadKind;
  sessionId: string;
  chatItemId: string;
  quote: string;
  setAt: string;
  supersededBy: number | null;
  // Taken down by the person with nothing in its place.
  retiredAt: string | null;
}

export type ProposalStatus = "open" | "pinned" | "dropped";

export interface PinProposal {
  id: number;
  workspaceId: string;
  leadKind: LeadKind;
  sessionId: string;
  chatItemId: string;
  quote: string;
  status: ProposalStatus;
  createdAt: string;
  resolvedAt: string | null;
}

export interface LeadMemo {
  id: number;
  workspaceId: string;
  leadKind: LeadKind;
  text: string;
  createdAt: string;
}

export interface LeadMessage {
  id: number;
  workspaceId: string;
  fromKind: LeadKind;
  toKind: LeadKind;
  thread: string;
  text: string;
  createdAt: string;
  readAt: string | null;
}

export interface LeadUsage {
  sessionId: string;
  leadKind: LeadKind;
  role: string;
  // Model calls (one per assistant response).
  calls: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}
