/**
 * What a moving task carries between machines, and the checks the arriving
 * side runs on it before anything touches git or the disk.
 */

import { isBranchName } from "../git";
import { CHAT_ACCESS, type ChatAccess } from "../chat/events";
import type { ProjectRef } from "./project-ref";
import type { MovedBookmark } from "../bookmarks/store";
import { MAX_NOTE_CHARS, MAX_SNAPSHOT_CHARS } from "../bookmarks/types";
import { isClaudeSessionId } from "./transcript";

// A long task's conversation runs to a few MB; this is far past that.
export const MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024;
// A chat's history as the UI shows it, and its queue (images inline). The
// whole bundle stays under what a linked machine reads of an answer
// (lib/hosts/remote-api), since a move back here reads it as one.
export const MAX_CHAT_BYTES = 12 * 1024 * 1024;
// A task's plan file is a page or two; this is far past that.
export const MAX_PLAN_BYTES = 1024 * 1024;
export const MAX_BUNDLE_BYTES =
  MAX_TRANSCRIPT_BYTES + MAX_CHAT_BYTES + MAX_PLAN_BYTES + 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isSessionId = (id: unknown): id is string =>
  typeof id === "string" && UUID.test(id);

/**
 * Another request is doing this right now. Not a refusal: the caller can't
 * tell yet whether it will land, so routes answer 503 for it.
 */
export class InProgressError extends Error {}

export const statusFor = (err: unknown, refused = 400) =>
  err instanceof InProgressError ? 503 : refused;

export interface TaskBundle {
  // The source session's id: importing the same move twice finds the first.
  moveId: string;
  name: string;
  prompt: string;
  model: string;
  branch: string;
  baseBranch: string | null;
  project: ProjectRef;
  // The machine it's leaving, for the note the agent reads on arrival.
  from: string;
  claude: {
    sessionId: string;
    cwd: string;
    home: string;
    transcript: string;
  } | null;
  // A chat task's own state; absent for a terminal task, or from a machine
  // that predates chat moves.
  chat?: ChatBundle;
  // What a task started by an orchestrator carries besides its work; absent
  // for any other task, or from a machine that predates these moves.
  orchestrated?: OrchestratedBundle;
}

export interface OrchestratedBundle {
  // The machine whose orchestrator holds the task, for the other machine's
  // screens and refusals.
  heldFrom: string;
  // When the task first started (an ISO time), so a PR opened before the
  // move still counts as the task's.
  since: string | null;
  // The model's provider and a task's own models, as they were; an arriving
  // machine without that provider refuses the task rather than change it.
  modelProvider: string | null;
  modelOverrides: string | null;
  planPhase: "planning" | "implementing" | null;
  // .agentos/plan.md, which is never in git.
  planFile: string | null;
  // The orchestrator that holds the task (its id and name on the machine
  // that runs it), so the task can message it from where it runs.
  orchestrator?: { id: string; name: string };
}

export interface ChatBundle {
  // chat_items, oldest first: the item's id and its JSON.
  items: { id: string; data: string }[];
  // chat_queue, in send order: what was waiting when it left.
  queue: {
    id: string;
    text: string;
    images: string | null;
    sentBy: string | null;
    createdAt: number;
  }[];
  access: ChatAccess;
  plan: boolean;
  // An undo's resume point not yet used up, and the context meter.
  resumeAt: string | null;
  context: string | null;
  // Its bookmarks; absent from a machine that predates them.
  bookmarks?: MovedBookmark[];
}

const isStr = (v: unknown): v is string => typeof v === "string";
const isStrOrNull = (v: unknown) => v === null || isStr(v);

const BOOKMARK_KINDS = ["user", "assistant", "tool", "turn"];
// Far past what a person stars in one chat.
export const MAX_MOVED_BOOKMARKS = 2000;

function validateChat(c: ChatBundle): ChatBundle {
  if (!c || typeof c !== "object" || !Array.isArray(c.items))
    throw new Error("Bad chat");
  if (!Array.isArray(c.queue)) throw new Error("Bad chat queue");
  if (!CHAT_ACCESS.includes(c.access)) throw new Error("Bad chat access");
  let bytes = 0;
  for (const i of c.items) {
    if (!i || !isStr(i.id) || !isStr(i.data)) throw new Error("Bad chat item");
    bytes += i.id.length + i.data.length;
  }
  for (const m of c.queue) {
    if (
      !m ||
      !isStr(m.id) ||
      !isStr(m.text) ||
      !isStrOrNull(m.images) ||
      !isStrOrNull(m.sentBy) ||
      !Number.isFinite(m.createdAt)
    )
      throw new Error("Bad queued message");
    bytes += m.id.length + m.text.length + (m.images?.length ?? 0);
  }
  if (c.bookmarks !== undefined && !Array.isArray(c.bookmarks))
    throw new Error("Bad chat bookmarks");
  if ((c.bookmarks?.length ?? 0) > MAX_MOVED_BOOKMARKS)
    throw new Error("Too many bookmarks to move");
  for (const b of c.bookmarks ?? []) {
    if (
      !b ||
      !isStr(b.itemId) ||
      b.itemId.length > 200 ||
      !(b.scope === "item" || b.scope === "turn") ||
      !BOOKMARK_KINDS.includes(b.kind) ||
      !isStr(b.text) ||
      b.text.length > MAX_SNAPSHOT_CHARS + 1 ||
      !isStrOrNull(b.note) ||
      (b.note?.length ?? 0) > MAX_NOTE_CHARS ||
      !isStr(b.createdAt)
    )
      throw new Error("Bad bookmark");
    bytes += b.itemId.length + b.text.length + (b.note?.length ?? 0);
  }
  if (bytes > MAX_CHAT_BYTES) throw new Error("The chat is too large to move");
  if (!isStrOrNull(c.resumeAt) || !isStrOrNull(c.context))
    throw new Error("Bad chat");
  return { ...c, plan: !!c.plan };
}

const PHASES = ["planning", "implementing"];

export function validateOrchestrated(
  o: OrchestratedBundle
): OrchestratedBundle {
  if (!o || typeof o !== "object") throw new Error("Bad orchestrated task");
  if (
    !isStrOrNull(o.since) ||
    !isStrOrNull(o.modelProvider) ||
    !isStrOrNull(o.modelOverrides) ||
    !isStrOrNull(o.planFile) ||
    !(o.planPhase === null || PHASES.includes(o.planPhase as string))
  )
    throw new Error("Bad orchestrated task");
  if (o.since !== null && Number.isNaN(Date.parse(o.since)))
    throw new Error("Bad start time");
  if ((o.planFile?.length ?? 0) > MAX_PLAN_BYTES)
    throw new Error("The plan is too large to move");
  return {
    heldFrom: String(o.heldFrom || "another machine")
      .replace(/[^\w.@ -]/g, "")
      .slice(0, 100),
    since: o.since,
    modelProvider: o.modelProvider,
    modelOverrides: o.modelOverrides,
    planPhase: o.planPhase,
    planFile: o.planFile,
    orchestrator:
      o.orchestrator &&
      isSessionId(o.orchestrator.id) &&
      typeof o.orchestrator.name === "string" &&
      o.orchestrator.name.trim()
        ? {
            id: o.orchestrator.id,
            name: o.orchestrator.name
              .replace(/[\u0000-\u001f]/g, " ")
              .trim()
              .slice(0, 200),
          }
        : undefined,
  };
}

export function validateBundle(b: TaskBundle): TaskBundle {
  if (!b || typeof b !== "object") throw new Error("No task to import");
  if (!isSessionId(b.moveId)) throw new Error("Bad move id");
  if (typeof b.branch !== "string" || !isBranchName(b.branch))
    throw new Error("Bad branch name");
  if (
    b.baseBranch !== null &&
    (typeof b.baseBranch !== "string" || !isBranchName(b.baseBranch))
  )
    throw new Error("Bad base branch name");
  if (
    typeof b.name !== "string" ||
    typeof b.prompt !== "string" ||
    typeof b.model !== "string"
  )
    throw new Error("Bad task");
  if (!b.project || typeof b.project.path !== "string")
    throw new Error("Bad project");
  if (b.claude) {
    const c = b.claude;
    if (!isClaudeSessionId(c.sessionId))
      throw new Error("Bad Claude session id");
    if ([c.cwd, c.home, c.transcript].some((v) => typeof v !== "string"))
      throw new Error("Bad conversation");
    if (c.transcript.length > MAX_TRANSCRIPT_BYTES)
      throw new Error("The conversation is too large to move");
  }
  return {
    ...b,
    orchestrated: b.orchestrated
      ? validateOrchestrated(b.orchestrated)
      : undefined,
    chat: b.chat ? validateChat(b.chat) : undefined,
    name: b.name.slice(0, 200),
    from: String(b.from || "another machine")
      .replace(/[^\w.@ -]/g, "")
      .slice(0, 100),
  };
}

export function arrivalNote(
  b: { from: string; branch: string },
  cwd: string,
  here: string
): string {
  return [
    `This task just moved from ${b.from} to ${here}. It now runs on ${here}: every command you run executes there, not on ${b.from}, so name ${here} when you report where something ran. Your worktree is now ${cwd}, on branch ${b.branch}.`,
    `Anything that was uncommitted came over as a commit starting "wip: moving to"; fold it into your own commits as you see fit.`,
    `Continue the task where you left off.`,
  ].join(" ");
}
