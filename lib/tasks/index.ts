/**
 * Async tasks: a prompt becomes an agent working alone in its own worktree,
 * which ends by opening a PR. A human signs off (merge + cleanup) or
 * drops it.
 */

import { taskCosts } from "../usage/calls";
import {
  parseOverride,
  resolveRole,
  sessionModelRef,
  type ModelOverride,
} from "../models/resolve";
import { effectiveModels } from "../models/config";
import { ANTHROPIC } from "../models/roles";
import { processTable, runsSomething } from "../process-table";
import { randomUUID } from "crypto";
import { db, queries, type Session } from "../db";
import { getProject } from "../projects";
import {
  createWorktree,
  discardLeftoverStart,
  worktreePathFor,
} from "../worktrees";
import {
  generateBranchName,
  getDefaultBranch,
  isBranchName,
  slugify,
} from "../git";
import { getProvider, type AgentType } from "../providers";
import { agentLabel } from "../agent-options";
import { supportsChat } from "../chat/capabilities";
import { AGENT_DEFAULT_MODEL } from "../providers/registry";
import { statusDetector } from "../status-detector";
import { buildTaskBrief, briefFacts, type StackedOn } from "./brief";
import {
  attachTaskCard,
  inBackground,
  syncTaskCardInBackground,
  taskCardUrl,
} from "../lumifyhub/task-cards";
import {
  blockedReason,
  deriveTaskState,
  type TaskPR,
  type TaskState,
} from "./state";
import { expandHome, prFor, storedPR, taskSessions } from "./session";
import { InProgressError, type OrchestratedBundle } from "./move-bundle";
import { holdFor, mayHold } from "./held";
import { orchestratorOf, recordStart, type StartVia } from "./starter";
import { claimable, claimPiece, releaseClaim } from "../plans/claim";
import { nameFor } from "../session-titles";
import { taskSetupOf, type TaskSetup } from "./setup";
import { taskPlan } from "./plan-view";
import type { TaskPlan } from "./loop-types";
import { finishTaskStart } from "./start";
import { isRemoteHost } from "../hosts";
import { DEFAULT_START_VIEW, type StartView } from "../sessions/launch";
import { viewOf } from "./move-targets";
import { isMirror, startRemoteTask } from "./contract/start";
import { mirrorViews } from "./contract/views";
import { chatStateNow } from "../chat/runner";
import { saidSinceLastMessage } from "../chat/store";

import { lastActiveOf } from "./last-active";
import { setPlan, setTask } from "../db/session-parts";
export * from "./state";
export { codeReviewGate, codeReviewRefusal } from "./code-review";
export { signOffTask, dropTask, signingOff, mergeSettled } from "./finish";
export { prFor as taskPR } from "./session";
export { assertMovable, moveTask } from "./move-flow";

export interface TaskView {
  id: string;
  name: string;
  prompt: string;
  projectId: string | null;
  projectName: string | null;
  branch: string | null;
  baseBranch: string | null;
  tmuxName: string;
  // How its agent runs; only a terminal task can move for now.
  view: StartView;
  // A running chat's turn, as its worker says ("unknown": unreachable). A
  // linked machine's blocked gate reads it: the derived state hides an open
  // question once a PR is up.
  chatTurn?: ChatTurn | null;
  state: TaskState;
  pr: TaskPR | null;
  // What its last BLOCKED: line asked for, while it's blocked.
  blocked: string | null;
  // The task's card on the project's LumifyHub board, when it has one.
  cardUrl: string | null;
  // Its worktree setup, which the agent waits for; null for older tasks.
  setup: TaskSetup | null;
  createdAt: string;
  // The machine running it, when that's not this one.
  hostId: string | null;
  hostName: string | null;
  // Why that machine couldn't say how it's doing.
  hostError: string | null;
  // Merges by itself once every gate passes (orchestrator/armed.ts).
  armed?: boolean;
  // What it runs on now, "provider/model", and whether it's still in its
  // plan step (lib/models).
  model?: string;
  planning?: boolean;
  // A plan-only task's plan is written and waits for approval.
  planReady?: boolean;
  // What its starter decided about a plan step, and why; null if unstated.
  // Its plan: ready to read or approve, with a title and capped text.
  plan?: TaskPlan | null;
  // A quick change: the orchestrator session that makes it (no agent).
  quickOf?: string | null;
  // What it has cost so far in weighted tokens (lib/usage/weights).
  weighted?: number;
  // Its last sign of life, in ms, for an orchestrator on another machine.
  lastActiveAt?: number;
  // Held for another machine's orchestrator (held.ts): which machine, and
  // the "plan written" line it would have been told.
  heldFrom?: string | null;
  planNote?: string | null;
}

export async function createTask(opts: {
  projectId: string;
  prompt: string;
  // Its name; generated from the prompt when absent.
  name?: string;
  // Its own model: "provider/model" (or an Anthropic alias) for all its
  // roles, or a map of role to one (lib/models). Its workspace's and
  // Settings' role models otherwise.
  model?: ModelOverride;
  // Plan first on the planning model (Settings' default otherwise).
  plan?: boolean;
  // Why the starter chose to plan or not: shown on the task's card.
  planReason?: string | null;
  // Stop after the plan and wait for approval (implies plan).
  planOnly?: boolean;
  // The session that started it (null: a person), the session it came from,
  // and how: every start says (tasks/starter.ts).
  startedBy?: string | null;
  parentSessionId?: string | null;
  startedVia: StartVia;
  // The waiting plan piece it builds: claimed for this task.
  pieceId?: number;
  // Started from this LumifyHub card, which the task then moves.
  cardId?: string;
  // Stacked: cut from another task's pushed branch, at this exact commit.
  base?: { branch: string; tip: string; stack: StackedOn };
  // Cut from this branch instead of the default one.
  baseBranch?: string;
  // The agent CLI that does the work (Claude Code unless a person picks
  // another). Another agent runs as a chat on this machine, on its own
  // default model unless `model` names one, without plan-first or role
  // models: those are Claude Code's.
  agent?: AgentType;
  // Called once the session row exists, before the agent launches.
  onCreated?: (sessionId: string) => void;
  // Run it on this machine (another one's own AgentOS); default: the project's.
  hostId?: string;
  // The caller's key for it: a retry with the same id gets the same task.
  id?: string;
  // A queued task's start: clear what an attempt cut off by a restart left
  // (its worktree and branch, when nothing is on them).
  reclaim?: boolean;
  // How its agent runs: as a chat (the default, DEFAULT_START_VIEW) or in
  // a terminal.
  view?: StartView;
  // Started by another machine's orchestrator, which this one holds it for
  // (held.ts): that machine's paired device and its description of the task.
  held?: { device: string; orchestrated: OrchestratedBundle };
  // The paired device that sent this keyed start: the only one that may hold it later.
  startedByDevice?: string | null;
  // Another machine placed this plan here and decides what follows it: the
  // task plans, then waits for that machine (implies planOnly).
  planWaits?: boolean;
}): Promise<Session> {
  if (opts.id) {
    const existing = queries.getSession(db).get(opts.id) as Session | undefined;
    if (existing?.task_status) {
      // A retry of a start that wasn't held holds it now, for the device
      // that started it and no other.
      if (opts.held && existing.held_by_device !== opts.held.device) {
        if (!mayHold(existing, opts.held.device))
          throw new Error("That id is taken");
        holdFor(existing.id, opts.held.device, opts.held.orchestrated);
      }
      return existing;
    }
    if (existing) throw new Error("That id is taken");
    if (starting.has(opts.id))
      throw new InProgressError("That task is starting already");
    starting.add(opts.id);
    try {
      return await startTask(opts, opts.id);
    } finally {
      starting.delete(opts.id);
    }
  }
  return startTask(opts, randomUUID());
}

// Whether a session already has this feature's worktree or branch: then
// it's that task's, never a cut-off start's leftover to clear.
export function ownedByATask(
  projectId: string,
  projectPath: string,
  feature: string
): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM sessions WHERE worktree_path = ? OR (project_id = ? AND branch_name = ?)`
    )
    .get(
      worktreePathFor(projectPath, feature),
      projectId,
      generateBranchName(feature)
    );
}

// Tasks being started in this process, by the caller's id.
const g = globalThis as unknown as { __agentosStartingTasks?: Set<string> };
const starting = (g.__agentosStartingTasks ??= new Set());

async function startTask(
  opts: Parameters<typeof createTask>[0],
  id: string
): Promise<Session> {
  const prompt = opts.prompt.trim();
  if (!prompt) throw new Error("Describe the task");
  const project = getProject(opts.projectId);
  if (!project || project.is_uncategorized) throw new Error("Pick a project");
  if (opts.pieceId) claimable(opts.pieceId);
  const hostId = opts.hostId ?? project.host_id;
  const view = opts.view ?? DEFAULT_START_VIEW;
  const agent = opts.agent ?? "claude";
  if (agent !== "claude") {
    if (!supportsChat(agent))
      throw new Error(`${agentLabel(agent)} can't run a task yet`);
    if (view !== "chat")
      throw new Error(`${agentLabel(agent)} runs a task as a chat`);
    if (opts.plan || opts.planOnly)
      throw new Error(`${agentLabel(agent)} doesn't plan first yet`);
    if (isRemoteHost(hostId))
      throw new Error(`${agentLabel(agent)} tasks run on this machine for now`);
  }
  if (isRemoteHost(hostId)) {
    if (opts.base || opts.cardId)
      throw new Error(
        "Stacked and card tasks run on this machine only for now"
      );
    if (opts.planOnly && opts.plan === false)
      throw new Error(
        "planOnly implies plan; it can't be combined with plan false"
      );
    if (opts.planOnly && view !== "chat")
      throw new Error("A plan-only task needs a chat, not a terminal");
    // The plan step is this machine's to run and decide: it plans there,
    // stops, and what follows is chosen here (contract/plan.ts).
    const planned =
      !!(opts.plan || opts.planOnly) &&
      taskRouting(
        project.workspace_id,
        view,
        opts.model,
        opts.plan,
        opts.planOnly
      ).plan;
    const session = await startRemoteTask(hostId, project, {
      id,
      prompt,
      name: opts.name,
      model: typeof opts.model === "string" ? opts.model : undefined,
      baseBranch: opts.baseBranch,
      view,
      startedBy: opts.startedBy,
      plan: planned
        ? { only: !!opts.planOnly, reason: opts.planReason?.trim() || null }
        : undefined,
    });
    // The mirror's started_by stays orchestrator-only: a held task on a linked machine is
    // relayed, stopped and answered through it. A plain calling task is its
    // parent and started_via only.
    recordStart(session.id, {
      startedBy: orchestratorOf(opts.startedBy),
      parentSessionId: opts.parentSessionId ?? null,
      startedVia: opts.startedVia,
      startedByDevice: opts.held?.device ?? opts.startedByDevice,
    });
    if (opts.pieceId) claimPiece(opts.pieceId, session.id);
    opts.onCreated?.(session.id);
    return session;
  }

  if (opts.baseBranch !== undefined && !isBranchName(opts.baseBranch))
    throw new Error(`"${opts.baseBranch}" isn't a branch name`);
  if (opts.planOnly && opts.plan === false)
    throw new Error(
      "planOnly implies plan; it can't be combined with plan false"
    );
  if (opts.planOnly && view !== "chat")
    throw new Error("A plan-only task needs a chat, not a terminal");
  const routing =
    agent === "claude"
      ? taskRouting(
          project.workspace_id,
          view,
          opts.model,
          opts.plan,
          opts.planOnly
        )
      : otherAgentRouting(opts.model);
  const projectPath = expandHome(project.working_directory);
  const naming = await nameFor(prompt, projectPath, opts.name);
  const feature = `${slugify(naming.name.split(/\s+/).slice(0, 6).join(" "))}-${id.slice(0, 4)}`;
  const baseBranch =
    opts.base?.branch ??
    opts.baseBranch ??
    (await getDefaultBranch(projectPath));
  // A queued start retried after a restart cut it off mid-setup: what it
  // made has no task (createTask returned early if it had one).
  if (opts.reclaim && !ownedByATask(project.id, projectPath, feature))
    await discardLeftoverStart(projectPath, feature);
  const wt = await createWorktree({
    projectPath,
    featureName: feature,
    baseBranch,
    startPoint: opts.base?.tip,
  });

  const provider = getProvider(agent);
  const model = routing.first.model;
  const tmuxName = `${provider.id}-${id}`;

  // Claimed right before the row exists, with nothing awaited between, so the
  // release sweep can't start the same piece.
  if (opts.pieceId) {
    try {
      claimPiece(opts.pieceId, id);
    } catch (error) {
      await discardLeftoverStart(projectPath, feature).catch(() => {});
      throw error;
    }
  }
  try {
    queries
      .createSession(db)
      .run(
        id,
        naming.name,
        tmuxName,
        wt.worktreePath,
        null,
        model,
        null,
        "sessions",
        agent,
        1,
        project.id,
        "local"
      );
    queries
      .updateSessionWorktree(db)
      .run(wt.worktreePath, wt.branchName, baseBranch, null, id);
    // Everything the launch needs is on the row, so a restart can resume it.
    db.prepare(
      `UPDATE sessions SET setup_status = 'running', name_source = ?, view = ?, model_provider = ? WHERE id = ?`
    ).run(
      naming.source,
      view,
      routing.first.provider.id === ANTHROPIC
        ? null
        : routing.first.provider.id,
      id
    );
    setTask(db, id, {
      task_prompt: prompt,
      task_brief: buildTaskBrief({
        branch: wt.branchName,
        baseBranch,
        stack: opts.base?.stack,
        ...briefFacts(wt.worktreePath),
      }),
      task_status: "running",
      model_overrides: routing.override
        ? JSON.stringify(routing.override)
        : null,
    });
    setPlan(db, id, {
      plan_phase: routing.plan ? "planning" : null,
      plan_only: routing.planOnly ? 1 : null,
      plan_decided: routing.planOnly
        ? 1
        : opts.plan === undefined
          ? null
          : opts.plan
            ? 1
            : 0,
      plan_reason: opts.planReason?.trim() || null,
      plan_waits_for_caller: routing.planOnly && opts.planWaits ? 1 : null,
    });
    recordStart(id, {
      startedBy: opts.startedBy ?? null,
      parentSessionId: opts.parentSessionId ?? null,
      startedVia: opts.startedVia,
      startedByDevice: opts.held?.device ?? opts.startedByDevice,
    });
  } catch (error) {
    // The claim was made for a session that never existed.
    if (opts.pieceId) releaseClaim(opts.pieceId, id);
    throw error;
  }
  if (opts.held) holdFor(id, opts.held.device, opts.held.orchestrated);
  opts.onCreated?.(id);
  void naming.refine?.(id);

  // The agent starts once its dependencies are there, so its first check
  // doesn't fail on a module still installing; nothing waits on that here.
  inBackground(`start of task ${id}`, () => finishTaskStart(id));

  const session = queries.getSession(db).get(id) as Session;
  inBackground(`card for task ${id}`, () =>
    attachTaskCard(session, project, opts.cardId)
  );
  return session;
}

// The agent runs under a shell (`zsh -c "...; claude ...; exec $SHELL"`), so
// the pane's command reads as the shell even while the agent works. It has
// exited when the shell is all that's left: nothing running under it. Read
// from the session listing and the shared process table, never a call per
// task; anything unknown reads as still running.
export async function shellOnly(tmuxName: string): Promise<boolean> {
  // Another machine's processes aren't in this one's table.
  if ((statusDetector.hostFor(tmuxName) ?? "local") !== "local") return false;
  const cmd = statusDetector.foregroundFor(tmuxName);
  const pid = statusDetector.paneProcess(tmuxName);
  if (!cmd || !pid || !/^-?(zsh|bash|sh|fish)$/.test(cmd)) return false;
  const rows = await processTable();
  return rows ? !runsSomething(rows, pid) : false;
}

// A chat's turn as its worker says: "unknown" when it can't be reached.
type ChatTurn =
  | NonNullable<Awaited<ReturnType<typeof chatStateNow>>>
  | "unknown";

// A chat between turns waits on the next message, as a terminal at its
// prompt does. One whose worker can't be reached counts as busy.
const chatStatus = (turn: ChatTurn | null): "running" | "waiting" =>
  turn === "running" || turn === "unknown" ? "running" : "waiting";

export async function taskView(session: Session): Promise<TaskView> {
  const live = session.task_status === "running";
  const setup = taskSetupOf(session);
  // A finished task's PR is in the database: only a running one asks gh.
  const chat = session.view === "chat";
  // A quick change has no agent: the orchestrator is working on it until
  // its PR is up, and nothing in it can be blocked.
  const quick = !!session.quick_of;
  const [pr, chatTurn, screen] = await Promise.all([
    live ? prFor(session) : storedPR(session),
    live && chat && !quick
      ? chatStateNow(session.id).catch((): ChatTurn => "unknown")
      : Promise.resolve(null),
    live && !chat && !quick
      ? statusDetector.getStatus(session.tmux_name)
      : Promise.resolve(undefined),
  ]);
  const sessionStatus = !live
    ? undefined
    : quick
      ? "running"
      : chat
        ? chatStatus(chatTurn)
        : screen;
  const agentGone =
    !chat &&
    !quick &&
    live &&
    sessionStatus !== "dead" &&
    sessionStatus !== undefined
      ? await shellOnly(session.tmux_name)
      : false;
  const planReady = live && session.plan_phase === "awaiting";
  // A plan waiting for approval isn't a question the agent asked.
  const blocked =
    live && sessionStatus === "waiting" && !planReady
      ? blockedReason(
          chat
            ? saidSinceLastMessage(session.id)
            : (await statusDetector.capturePane(session.tmux_name))
                .split("\n")
                .slice(-15)
                .join("\n")
        )
      : null;
  const project = session.project_id ? getProject(session.project_id) : null;
  const state = deriveTaskState({
    taskStatus: session.task_status ?? "running",
    sessionStatus: agentGone ? "dead" : sessionStatus,
    pr,
    blocked: blocked !== null,
    planReady,
    settingUp: setup?.status === "running" || setup?.status === "held",
  });
  syncTaskCardInBackground(session, state, pr);
  return {
    id: session.id,
    name: session.name,
    prompt: session.task_prompt || "",
    projectId: session.project_id,
    projectName: project?.name ?? null,
    branch: session.branch_name,
    baseBranch: session.base_branch,
    tmuxName: session.tmux_name,
    view: viewOf(session),
    chatTurn,
    state,
    pr,
    blocked,
    cardUrl: taskCardUrl(session),
    setup,
    createdAt: session.created_at,
    hostId: null,
    hostName: null,
    hostError: null,
    armed: !!session.merge_armed_at,
    model: sessionModelRef(session),
    planning: session.plan_phase === "planning",
    planReady,
    plan: taskPlan(session),
    quickOf: session.quick_of ?? null,
    lastActiveAt: session.held_by_device ? lastActiveOf(session) : undefined,
    heldFrom: session.held_by_device ? (session.held_from ?? null) : null,
    planNote: session.held_by_device ? (session.plan_note ?? null) : null,
  };
}

/** Tasks this machine handed to another, for that machine's mirror of them. */
export function movedTasks(): { id: string; movedTo: string | null }[] {
  return db
    .prepare(
      `SELECT id, moved_to AS movedTo FROM session_rows
         WHERE task_status = 'moved' AND host_id = 'local'
         ORDER BY updated_at DESC LIMIT 500`
    )
    .all() as { id: string; movedTo: string | null }[];
}

// Archived tasks aren't listed.
export async function listTasks(): Promise<TaskView[]> {
  const sessions = taskSessions(false);
  const [local, remote] = await Promise.all([
    Promise.all(sessions.filter((s) => !isMirror(s)).map(taskView)),
    mirrorViews(sessions.filter(isMirror)),
  ]);
  const costs = taskCosts(local.map((t) => t.id));
  for (const t of local) {
    const w = costs.get(t.id);
    if (w) t.weighted = w;
  }
  return [...local, ...remote].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
}

// Another agent's task: its own model (or its default), never planned first.
function otherAgentRouting(model: unknown) {
  return {
    override: null,
    plan: false,
    planOnly: false,
    first: {
      model: typeof model === "string" && model ? model : AGENT_DEFAULT_MODEL,
      provider: { id: ANTHROPIC },
    },
  };
}

// The model a task starts on, and whether it plans first: only as a chat,
// where the handoff can follow the end of its plan turn, and only when
// planning and implementing are on different models. Both roles resolve
// now, so a bad override or a provider that's off fails the start.
export function taskRouting(
  workspaceId: string | null,
  view: StartView,
  model: unknown,
  plan?: boolean,
  planOnly?: boolean
) {
  const override = parseOverride(model);
  const models = effectiveModels();
  const opts = { workspaceId, override };
  const implement = resolveRole("implement", opts, models);
  const planning = resolveRole("plan", opts, models);
  // Plan only plans even on one model: the stop is the point, not a switch.
  const planStep =
    view === "chat" &&
    (!!planOnly ||
      ((plan ?? models.planStep) && planning.ref !== implement.ref));
  return {
    override,
    plan: planStep,
    planOnly: planStep && !!planOnly,
    first: planStep ? planning : implement,
  };
}
