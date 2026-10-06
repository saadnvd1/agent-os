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
  // Card dependencies (stacks). Older servers leave these out.
  blocked_by?: LhCardRef[];
  parent_id?: string | null;
  completed?: boolean;
}

export interface LhCardRef {
  id: string;
  ticket: string | null;
}

// A card as the dependencies endpoint renders it.
export interface LhDependencyCard extends LhCardRef {
  title: string;
  list_id: string;
  completed: boolean;
}

export interface LhDependencies {
  blocked_by: LhDependencyCard[];
  blocks: LhDependencyCard[];
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

// A document page, as `/api/cli/pages` renders it: markdown in `content`.
export interface LhPage {
  id: string;
  title: string;
  parent_page_id: string | null;
  content: string;
  workspace_id: string;
  workspace_slug: string;
  updated_at: string;
  page_type: string | null;
}

// A page in the Docs list, without its body.
export interface DocSummary {
  id: string;
  title: string;
  parentId: string | null;
  updatedAt: string;
}

export interface DocView extends DocSummary {
  content: string;
  url: string;
}

// A repo file published to a page.
export interface PublishedDoc {
  repoPath: string;
  pageId: string;
  url: string;
  publishedAt: string;
}
