import { resumeOnModel } from "../models/resume";
import { workspaceTask } from "./targets";
import { getWorkspace } from "../workspaces";
import {
  approveTaskPlan,
  archive,
  done,
  drop,
  moveTaskTo,
  send,
  stack,
  stackStatus,
  startSession,
  startTask,
  stop,
} from "./act";
import { readCards } from "./cards";
import { readLogs } from "./logs";
import { describeSessions } from "./describe";
import { sessionFacts } from "./facts";
import { describeExternal, externalSessions } from "./external-sessions";
import { resolveStaleAsks } from "./ask-settle";
import { addNote } from "./notes";
import { addProject } from "./add-project";
import { addRule, removeRule } from "./rules";
import { askSaad } from "./ask-tool";
import { askQuestion, resolveQuestion } from "./questions";
import { listOrchestratorPeers, messageOrchestrator } from "./cross";
import { PAUSED_REFUSAL } from "./pause";
import { readSession } from "./read";
import { reviewTarget, signOffTarget } from "./external-gates";
import { land } from "./signoff";
import { arm, disarm } from "./armed";
import { quickChange, quickPR } from "./quick";
import { review } from "./review";
import { planPiecesText } from "./plan-pieces";
import {
  recipesText,
  runRecipe,
  saveRecipe,
  updateRecipeTool,
} from "./recipe-tools";
import { cancelReminder, listReminders, remindMe } from "./reminders";
import { parseArgs as p, type ToolName } from "./tool-schemas";

export { isToolName, TOOLS, type ToolName } from "./tool-schemas";

// What a pause stops: everything that changes the workspace or spends.
const ACTING = new Set<ToolName>([
  "send",
  "message_orchestrator",
  "start_task",
  "set_task_model",
  "start_session",
  "run_recipe",
  "recipe_save",
  "recipe_update",
  "quick_change",
  "quick_pr",
  "stack",
  "land",
  "drop",
  "move",
  "approve_plan",
  "plan_pieces",
  "stop",
  "done",
  "review",
  "sign_off",
  "arm",
  "add_project",
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
      const [facts, external] = await Promise.all([
        sessionFacts(w),
        externalSessions(w).catch(() => []),
      ]);
      resolveStaleAsks(w);
      return [
        describeSessions(workspace.name, facts),
        describeExternal(external),
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    case "read": {
      const a = p(tool, raw);
      return readSession(w, a.session, a.lines);
    }
    case "cards":
      return readCards(w, p(tool, raw).board);
    case "logs": {
      const a = p(tool, raw);
      return readLogs(w, a);
    }
    case "send": {
      const a = p(tool, raw);
      return send(w, a.session, a.message, {
        scopeChange: a.scope_change,
      });
    }
    case "orchestrators":
      p(tool, raw);
      return listOrchestratorPeers(w);
    case "message_orchestrator": {
      const a = p(tool, raw);
      return messageOrchestrator(w, a.workspace, a.message);
    }
    case "start_task": {
      const a = p(tool, raw);
      return startTask(w, a.project, a.prompt, {
        base: a.base,
        name: a.name,
        view: a.view,
        after: a.after,
        model: a.model,
        plan: a.plan,
        planOnly: a.plan_only,
        planReason: a.plan_reason,
      });
    }
    case "approve_plan": {
      const a = p(tool, raw);
      const task = workspaceTask(w, a.task);
      return approveTaskPlan(task, a.message);
    }
    case "plan_pieces": {
      const a = p(tool, raw);
      return planPiecesText(workspaceTask(w, a.task), a.merge, a.drop);
    }
    case "set_task_model": {
      const a = p(tool, raw);
      const task = workspaceTask(w, a.task);
      const out = await resumeOnModel(task.id, a.model, a.message);
      return out.resumed
        ? `Resumed ${task.name} on ${out.ref}: same conversation and worktree.`
        : `${task.name} hasn't launched yet; it starts on ${out.ref}.`;
    }
    case "start_session": {
      const a = p(tool, raw);
      return startSession(w, a.project, a.prompt, {
        name: a.name,
        view: a.view,
        model: a.model,
      });
    }
    case "quick_change": {
      const a = p(tool, raw);
      return quickChange(w, a.project, a.name);
    }
    case "quick_pr": {
      const a = p(tool, raw);
      const opened = await quickPR(w, a.change, a.title, a.body);
      // Its code-review gate is this review: it starts at once.
      const reviewing = await review(w, opened.id).catch(
        (e: Error) => `Its review couldn't start (${e.message}): call review.`
      );
      return `${opened.text}\n${reviewing}`;
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
    case "move": {
      const a = p(tool, raw);
      return moveTaskTo(w, a.task, a.machine);
    }
    case "stop":
      return stop(w, p(tool, raw).session);
    case "done":
      return done(w, p(tool, raw).session);
    case "archive":
      return archive(w, p(tool, raw).session);
    case "add_project": {
      const a = p(tool, raw);
      return addProject(w, a.path, a.name);
    }
    case "note":
      addNote(w, p(tool, raw).text);
      return "Noted.";
    case "rule_add": {
      const rule = addRule(w, p(tool, raw).text, "orchestrator");
      addNote(w, `Standing rule ${rule.id}: ${rule.text}`);
      return `Rule ${rule.id} kept: it's in your brief on every start.`;
    }
    case "rule_remove": {
      const rule = removeRule(w, p(tool, raw).id, "orchestrator");
      addNote(w, `Removed standing rule ${rule.id}: ${rule.text}`);
      return `Rule ${rule.id} removed.`;
    }
    case "remind_me": {
      const a = p(tool, raw);
      return remindMe(w, a.at, a.prompt, a.name);
    }
    case "recipes":
      return recipesText(w, p(tool, raw).name);
    case "run_recipe": {
      const a = p(tool, raw);
      return runRecipe(w, a.name, a.note);
    }
    case "recipe_save":
      return saveRecipe(w, p(tool, raw));
    case "recipe_update":
      return updateRecipeTool(w, p(tool, raw));
    case "reminders":
      return listReminders(w);
    case "cancel_reminder":
      return cancelReminder(w, p(tool, raw).id);
    case "review": {
      const a = p(tool, raw);
      return reviewTarget(w, a.target, { fresh: a.fresh });
    }
    case "sign_off":
      return signOffTarget(w, p(tool, raw).task);
    case "arm":
      return arm(w, p(tool, raw).task);
    case "disarm":
      return disarm(w, p(tool, raw).task);
    case "ask_saad":
      return askSaad(w, p(tool, raw));
    case "question": {
      const a = p(tool, raw);
      return askQuestion(w, a.text, a.task);
    }
    case "resolve_question": {
      const id = p(tool, raw).id;
      return resolveQuestion(w, id, "orchestrator")
        ? `Question ${id} cleared.`
        : `No open question ${id}.`;
    }
  }
}
