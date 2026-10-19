export type SnippetSegment = { text: string; hit: boolean };

export interface ConversationHit {
  itemId: string;
  role: "user" | "assistant";
  createdAt: number | null;
  snippet: SnippetSegment[];
}

export interface ConversationGroup {
  sessionId: string;
  name: string;
  projectId: string | null;
  projectName: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  status: string;
  updatedAt: string | null;
  hits: ConversationHit[];
}

export interface SearchScope {
  // A workspace id, or "all".
  workspace: string;
  project?: string;
}

export interface SearchResponse {
  groups: ConversationGroup[];
  // More sessions exist past this page.
  more: boolean;
  tookMs: number;
  // The first backfill is still running, so older conversations may be missing.
  indexing: number | null;
  // The words to mark in a preview.
  terms: string[];
}

export interface ContextItem {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number | null;
  hit: boolean;
}
