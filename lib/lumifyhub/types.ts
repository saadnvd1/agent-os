// Shapes of LumifyHub's token API (`/api/cli/*`), as the Rails CLI
// controllers and `CliSerializers` render them. Only the fields AgentOS reads.

export interface LhUser {
  id: string;
  email: string;
  name: string | null;
}

export interface LhWorkspace {
  id: string;
  name: string;
  slug: string;
}

export interface LhBoard {
  id: string;
  page_id: string | null;
  workspace_id: string;
  workspace_slug: string;
  title: string;
  ticket_prefix: string | null;
}

export type LhListCategory =
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";

export interface LhList {
  id: string;
  board_id: string;
  name: string;
  position: number;
  category: LhListCategory;
}

// A TipTap/ProseMirror document, or a bare string on older cards.
export type LhRichText =
  | string
  | { type?: string; text?: string; content?: LhRichText[] }
  | null;

export interface LhCard {
  id: string;
  ticket: string | null;
  board_id: string;
  list_id: string;
  list_name: string | null;
  title: string;
  description: LhRichText;
  position: number;
}

// What the UI is allowed to see about the connection. Never the token.
export interface LumifyHubStatus {
  connected: boolean;
  baseUrl: string;
  user: { id: string | null; email: string | null; name: string | null } | null;
}

// A To Do card a task can be started from.
export interface BoardCardView {
  id: string;
  ticket: string | null;
  title: string;
  url: string | null;
}

export interface BoardTodo {
  projectId: string;
  projectName: string;
  boardName: string | null;
  cards: BoardCardView[];
}
