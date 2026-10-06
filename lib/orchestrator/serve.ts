import { getWorkspace } from "../workspaces";
import {
  drop,
  send,
  stack,
  stackStatus,
  startSession,
  startTask,
  stop,
} from "./act";
import { readCards } from "./cards";
import { describeSessions } from "./describe";
import { sessionFacts } from "./facts";
import { addNote } from "./notes";
import { readSession } from "./read";
import { review } from "./review";
import { land, signOff } from "./signoff";

export const TOOLS = [
  "sessions",
  "read",
  "cards",
  "send",
  "start_task",
  "start_session",
  "stack",
  "stack_status",
  "land",
  "drop",
  "stop",
  "note",
  "review",
  "sign_off",
] as const;

export type ToolName = (typeof TOOLS)[number];

export interface ToolArgs {
  session?: string;
  lines?: number;
  board?: string;
  message?: string;
  project?: string;
  prompt?: string;
  base?: string;
  target?: string;
  plan_only?: boolean;
  id?: string;
  task?: string;
  reason?: string;
  text?: string;
  fresh?: boolean;
}

const need = (value: string | undefined, what: string): string => {
  if (!value?.trim()) throw new Error(`Say ${what}`);
  return value;
};

// The orchestrator's tools, each scoped to its workspace, answered as
// compact text.
export async function runTool(
  workspaceId: string,
  tool: ToolName,
  args: ToolArgs = {}
): Promise<string> {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) throw new Error("Unknown workspace");
  const w = workspaceId;
  switch (tool) {
    case "sessions":
      return describeSessions(workspace.name, await sessionFacts(w));
    case "read":
      return readSession(
        w,
        need(args.session, "which session to read"),
        args.lines
      );
    case "cards":
      return readCards(w, args.board);
    case "send":
      return send(
        w,
        need(args.session, "who to send to"),
        need(args.message, "the message")
      );
    case "start_task":
      return startTask(
        w,
        need(args.project, "which project"),
        need(args.prompt, "the task"),
        args.base
      );
    case "start_session":
      return startSession(
        w,
        need(args.project, "which project"),
        need(args.prompt, "the prompt")
      );
    case "stack":
      return stack(
        w,
        need(args.target, "which board or project"),
        args.plan_only
      );
    case "stack_status":
      return stackStatus(w, need(args.id, "which stack"));
    case "land":
      return land(w, need(args.id, "which stack"));
    case "drop":
      return drop(w, need(args.task, "which task"), need(args.reason, "why"));
    case "stop":
      return stop(w, need(args.session, "which session"));
    case "note":
      addNote(w, need(args.text, "what to note"));
      return "Noted.";
    case "review":
      return review(w, need(args.target, "which PR or task"), {
        fresh: args.fresh,
      });
    case "sign_off":
      return signOff(w, need(args.task, "which task"));
  }
}

export const isToolName = (t: unknown): t is ToolName =>
  (TOOLS as readonly unknown[]).includes(t);
