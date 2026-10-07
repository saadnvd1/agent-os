import { getWorkspace } from "../workspaces";
import {
  done,
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
import { resolveStaleAsks } from "./ask-settle";
import { addNote } from "./notes";
import { askSaad } from "./ask-tool";
import { PAUSED_REFUSAL } from "./pause";
import { readSession } from "./read";
import { review } from "./review";
import { land, signOff } from "./signoff";
import { parseArgs as p, type ToolName } from "./tool-schemas";

export { isToolName, TOOLS, type ToolName } from "./tool-schemas";

// What a pause stops: everything that changes the workspace or spends.
const ACTING = new Set<ToolName>([
  "send",
  "start_task",
  "start_session",
  "stack",
  "land",
  "drop",
  "stop",
  "done",
  "review",
  "sign_off",
]);

// The orchestrator's tools, each scoped to its workspace and its arguments
// validated, answered as compact text.
export async function runTool(
  w: string,
  tool: ToolName,
  raw: unknown = {}
): Promise<string> {
  const workspace = getWorkspace(w);
  if (!workspace) throw new Error("Unknown workspace");
  if (workspace.orch_paused_at && ACTING.has(tool))
    throw new Error(PAUSED_REFUSAL);
  switch (tool) {
    case "sessions": {
      p(tool, raw);
      const facts = await sessionFacts(w);
      resolveStaleAsks(w);
      return describeSessions(workspace.name, facts);
    }
    case "read": {
      const a = p(tool, raw);
      return readSession(w, a.session, a.lines);
    }
    case "cards":
      return readCards(w, p(tool, raw).board);
    case "send": {
      const a = p(tool, raw);
      return send(w, a.session, a.message);
    }
    case "start_task": {
      const a = p(tool, raw);
      return startTask(w, a.project, a.prompt, a.base, a.name);
    }
    case "start_session": {
      const a = p(tool, raw);
      return startSession(w, a.project, a.prompt, a.name);
    }
    case "stack": {
      const a = p(tool, raw);
      return stack(w, a.target, a.plan_only);
    }
    case "stack_status":
      return stackStatus(w, p(tool, raw).id);
    case "land":
      return land(w, p(tool, raw).id);
    case "drop": {
      const a = p(tool, raw);
      return drop(w, a.task, a.reason);
    }
    case "stop":
      return stop(w, p(tool, raw).session);
    case "done":
      return done(w, p(tool, raw).session);
    case "note":
      addNote(w, p(tool, raw).text);
      return "Noted.";
    case "review": {
      const a = p(tool, raw);
      return review(w, a.target, { fresh: a.fresh });
    }
    case "sign_off":
      return signOff(w, p(tool, raw).task);
    case "ask_saad":
      return askSaad(w, p(tool, raw));
  }
}
