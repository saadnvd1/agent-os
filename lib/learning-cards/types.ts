export type CardKind = "recipe" | "lesson";
export type CardStatus = "pending" | "accepted" | "dismissed";
export type Destination = "recipe" | "claude_md" | "check" | "rule";

export interface RecipePayload {
  signals: string[];
  brief: string;
  summary: string;
}

export interface LessonPayload {
  lesson: string;
  destination: Destination;
  recipeId?: string;
  recipeName?: string;
  projectId?: string;
  projectName?: string;
  taskPrompt?: string;
  pairs: number;
}

export interface Card {
  id: number;
  session_id: string;
  workspace_id: string | null;
  kind: CardKind;
  status: CardStatus;
  payload: RecipePayload | LessonPayload;
  destination: Destination | null;
  applied_ref: string | null;
  shown_at: number | null;
  decided_at: number | null;
  created_at: number;
}

// One step of a session, cut down to what the scripts read.
export type Step =
  | { kind: "user"; text: string; byPerson: boolean }
  | {
      kind: "tool";
      name: string;
      ok: boolean;
      failed: boolean;
      command: string;
      path: string;
      input: string;
      output: string;
    };

export interface RunInfo {
  status: string;
  summary: string;
  error: string;
  // Settled: not queued, starting or running.
  settled: boolean;
}

// What the scripts know about one session. Never the transcript.
export interface SessionInput {
  id: string;
  name: string;
  workspaceId: string | null;
  projectId: string | null;
  skip: string | null;
  brief: string;
  final: string;
  steps: Step[];
  reviews: { status: string; detail: string }[];
  inRepo: boolean;
  run: (RunInfo & { recipeId: string }) | null;
  previousRun: RunInfo | null;
  recentBriefs: string[];
}

export interface Pair {
  kind: "tool-retry" | "review" | "user-correction" | "recipe-retry";
  before: string;
  after: string;
}

// A pending card as a list shows it, without the whole payload.
export interface PendingCardView {
  id: number;
  sessionId: string;
  sessionName: string;
  workspaceId: string | null;
  kind: CardKind;
  // One line: the lesson, or the recipe's summary.
  title: string;
  destination: Destination | null;
  createdAt: number;
}

const TITLE_MAX = 140;

export function cardTitle(c: Pick<Card, "kind" | "payload">): string {
  const p = c.payload as Partial<RecipePayload & LessonPayload>;
  const raw =
    c.kind === "lesson" ? p.lesson : p.summary || p.brief?.split("\n")[0];
  const line = (raw ?? "").replace(/\s+/g, " ").trim();
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX)}…` : line;
}
