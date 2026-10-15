/**
 * Resurrect: bring a dropped, done or archived session back with the same id
 * and the same agent conversation. An archived session is unarchived; a plain
 * one on the Done shelf is reopened; a task gets its worktree back (from the
 * snapshot an end saved, or its branch), its status back to what it was (a
 * plan-only task waits for approval again, one with a PR is idle) and a PR
 * that a drop closed is reopened. Everything is checked before anything is
 * changed, and a failure part-way puts the status back. The agent isn't
 * started: a chat resumes on its next message, so a restore costs no tokens.
 */

import fs from "fs";
import path from "path";
import { db, queries, type Session } from "../db";
import { getProject } from "../projects";
import { unarchiveSession } from "../done/archive";
import { reopenSession } from "../sidebar/shelf-state";
import { peerSessionLink } from "../hosts/peer-actions";
import { hostApi, hostLink } from "../hosts/remote-api";
import {
  forget as forgetHostTasks,
  unknownOutcome,
} from "../tasks/contract/client";
import { isMirror } from "../tasks/contract/start";
import { heldRefusal } from "../tasks/held";
import { expandHome, projectPathFor } from "../tasks/session";
import { run } from "../tasks/gh";
import { gitPush } from "../git-exec";
import {
  isClaudeSessionId,
  readTranscript,
  rewritePaths,
  transcriptPath,
  writeTranscript,
} from "../tasks/transcript";
import { buildTaskBrief, declaredTest } from "../tasks/brief";
import { syncTaskCardInBackground } from "../lumifyhub/task-cards";
import { allocatePorts } from "../ports";
import { loadProjectConfig, portBases } from "../project-config";
import { ensureSessionDatabase } from "../project-config/database";
import { runInBackground } from "../async-operations";
import { setupWorktree } from "../env-setup";
import { launchClaude } from "../agents/launch";
import { PLAN_FILE, preparePlanDir } from "../models/plan-step";
import { planFromTranscript } from "./plan";
import { dropSnapshot, restoreWorktree, type RestoredAs } from "./snapshot";
import { restoreSwept, sweptNote } from "./swept";
import { forgetSwept } from "../worktree-sweep/store";
import { setPr, setTask } from "../db/session-parts";

export interface ResurrectOptions {
  // The paired device asking: a task held for another machine's orchestrator
  // is restored only from there.
  device?: string | null;
}

export interface ResurrectOutcome {
  id: string;
  name: string;
  restored: "unarchived" | "reopened" | "task";
  worktree: RestoredAs | "chat-only" | "none";
  prReopened: number | null;
  text: string;
}

const row = (id: string) =>
  queries.getSession(db).get(id) as Session | undefined;

const ENDED_TASK = new Set(["dropped", "done"]);

// Restores in flight here, so two clicks can't both build a worktree.
const g = globalThis as unknown as { __agentosResurrecting?: Set<string> };
const inFlight = (g.__agentosResurrecting ??= new Set());
export const restoring = (id: string) => inFlight.has(id);

interface PrInfo {
  number: number;
  state: string;
}

// The task's PR as GitHub has it now. Throws when GitHub can't be asked: a
// merged PR must never be mistaken for an open one.
async function prState(repo: string, number: number): Promise<PrInfo | null> {
  const out = await run(
    "gh",
    ["pr", "view", String(number), "--json", "number,state"],
    repo
  ).catch((err) => {
    throw new Error(
      `Can't check PR #${number} on GitHub (${(err as Error).message.split("\n")[0]}); try again.`
    );
  });
  try {
    const pr = JSON.parse(out) as PrInfo;
    return typeof pr.state === "string" ? pr : null;
  } catch {
    return null;
  }
}

export async function resurrectSession(
  id: string,
  opts: ResurrectOptions = {}
): Promise<ResurrectOutcome> {
  const s = row(id);
  if (!s) throw new Error("Session not found");
  if (s.role === "orchestrator")
    throw new Error(`${s.name} is an orchestrator; it isn't ended.`);
  const held = opts.device !== undefined && heldRefusal(id, opts.device);
  if (held) throw new Error(held);
  const peer = peerSessionLink(s);
  if (peer)
    throw new Error(`${s.name} runs on ${peer.hostName}: restore it there.`);
  if (isMirror(s)) return onItsMachine(s);

  const endedTask = !!s.task_status && ENDED_TASK.has(s.task_status);
  if (s.task_status === "merged")
    throw new Error(
      `${s.name} was merged: its work is in the base branch. Start a new task to continue it.`
    );
  if (s.task_status === "running" || s.task_status === "moving")
    throw new Error(`${s.name} is still running; nothing to restore.`);
  if (s.task_status === "moved")
    throw new Error(`${s.name} was moved to another machine; it runs there.`);

  // Archived work just unarchives; a dropped task is hidden either way, so
  // restoring it is the whole of it.
  if (!endedTask || (s.archived_at && s.task_status !== "dropped")) {
    if (s.archived_at) {
      const swept = await restoreSwept(s);
      unarchiveSession(id);
      return outcome(
        s,
        "unarchived",
        `${s.name} is back in the sidebar${swept ? `; ${swept}` : ""}.`
      );
    }
    if (s.settled_at) {
      const swept = await restoreSwept(s);
      reopenSession(id);
      return outcome(
        s,
        "reopened",
        `${s.name} reopened${swept ? `; ${swept}` : ""}.`
      );
    }
    throw new Error(`${s.name} isn't dropped, done or archived.`);
  }
  return restoreTask(s, s.task_status as "dropped" | "done");
}

const outcome = (
  s: Pick<Session, "id" | "name">,
  restored: ResurrectOutcome["restored"],
  text: string,
  extra: Partial<ResurrectOutcome> = {}
): ResurrectOutcome => ({
  id: s.id,
  name: s.name,
  restored,
  worktree: "none",
  prReopened: null,
  text,
  ...extra,
});

// A task that runs on a linked machine resumes there; when that machine is
// gone for good, the task it was moved from is brought back here instead.
async function onItsMachine(s: Session): Promise<ResurrectOutcome> {
  const link = hostLink(s.host_id);
  if (link) {
    try {
      const res = await hostApi<{ outcome?: Partial<ResurrectOutcome> }>(
        link,
        `/api/sessions/${encodeURIComponent(s.id)}/resurrect`,
        { body: {}, timeout: 120_000 }
      );
      setTask(
        db,
        s.id,
        { task_status: "running" },
        { task_status: ["dropped", "done"] }
      );
      forgetHostTasks(link.hostId);
      return outcome(
        s,
        "task",
        `${link.hostName}: ${String(res.outcome?.text ?? `${s.name} restored.`).slice(0, 500)}`
      );
    } catch (err) {
      if (!unknownOutcome(err)) throw err;
    }
  }
  const before = db
    .prepare(
      `SELECT * FROM session_rows WHERE host_id = 'local' AND task_status = 'moved'
         AND project_id IS ? AND branch_name IS ? ORDER BY updated_at DESC LIMIT 1`
    )
    .get(s.project_id, s.branch_name) as Session | undefined;
  const where = link?.hostName ?? "its machine";
  if (!before)
    throw new Error(
      `${s.name} ran on ${where}, which can't be reached, and nothing of it was kept here.`
    );
  const here = await restoreTask(before, "moved");
  return {
    ...here,
    text: `${where} can't be reached, so ${here.name} is back here from before it moved: anything it did there that was never pushed is lost. ${here.text}`,
  };
}

async function restoreTask(
  s: Session,
  prev: "dropped" | "done" | "moved"
): Promise<ResurrectOutcome> {
  const project = s.project_id ? getProject(s.project_id) : null;
  const repo = project ? projectPathFor(s) : null;
  if (!project || !repo)
    throw new Error(`${s.name}'s project was removed; it can't come back.`);
  if (!fs.existsSync(repo))
    throw new Error(`${s.name}'s project folder ${repo} is gone.`);
  const oldCwd = expandHome(s.worktree_path ?? s.working_directory);
  const claudeId = s.claude_session_id;
  if (claudeId) {
    if (
      !isClaudeSessionId(claudeId) ||
      !fs.existsSync(transcriptPath(oldCwd, claudeId))
    )
      throw new Error(
        `${s.name}'s conversation is gone (no transcript on disk), so it can't be resumed. Start a new task.`
      );
  } else if (
    !db
      .prepare(`SELECT 1 FROM chat_items WHERE session_id = ? LIMIT 1`)
      .get(s.id)
  )
    throw new Error(`${s.name} has no conversation to bring back.`);
  if (s.branch_name) {
    const busy = db
      .prepare(
        `SELECT name FROM session_rows WHERE project_id = ? AND branch_name = ? AND id != ?
           AND task_status IN ('running', 'moving') AND host_id = 'local'`
      )
      .get(project.id, s.branch_name, s.id) as { name: string } | undefined;
    if (busy)
      throw new Error(
        `${busy.name} is running on ${s.branch_name} now; finish or drop it first.`
      );
  }
  const pr =
    s.pr_number && s.pr_status !== "merged"
      ? await prState(repo, s.pr_number)
      : null;
  if (s.pr_status === "merged" || pr?.state === "MERGED")
    throw new Error(
      `${s.name}'s PR #${s.pr_number} was merged; start a new task to continue it.`
    );

  if (inFlight.has(s.id))
    throw new Error(`${s.name} is being restored already.`);
  inFlight.add(s.id);
  const claimed = setTask(
    db,
    s.id,
    { task_status: "running", task_ended_at: null },
    { task_status: prev }
  );
  if (!claimed) {
    inFlight.delete(s.id);
    throw new Error(`${s.name} is being restored already.`);
  }
  try {
    return await bringBack(s, prev, repo, oldCwd, pr);
  } catch (err) {
    setTask(db, s.id, { task_status: prev }, { task_status: "running" });
    throw err;
  } finally {
    inFlight.delete(s.id);
  }
}

// Claude files a conversation under the folder it ran in: a worktree that
// comes back elsewhere takes its transcript with it.
async function carryTranscript(
  claudeId: string,
  from: string,
  to: string
): Promise<void> {
  if (path.resolve(from) === path.resolve(to)) return;
  const text = await readTranscript(from, claudeId);
  if (text === null) return;
  const home = process.env.HOME ?? "";
  await writeTranscript(
    to,
    claudeId,
    rewritePaths(text, { cwd: from, home }, { cwd: to, home })
  );
}

async function bringBack(
  s: Session,
  prev: "dropped" | "done" | "moved",
  repo: string,
  oldCwd: string,
  pr: PrInfo | null
): Promise<ResurrectOutcome> {
  // A plan that was never approved has no commits to lose.
  const planOnly =
    !!s.plan_only &&
    !s.pr_number &&
    (s.plan_phase === "awaiting" || s.plan_phase === "planning");
  const restored = s.branch_name
    ? await restoreWorktree({
        sessionId: s.id,
        repo,
        branch: s.branch_name,
        base: s.base_branch,
        oldPath: s.worktree_path ? expandHome(s.worktree_path) : null,
        allowFresh: planOnly,
      })
    : null;
  const cwd = restored?.path ?? repo;
  if (s.claude_session_id)
    await carryTranscript(s.claude_session_id, oldCwd, cwd);

  if (restored && s.plan_phase === "awaiting")
    await recoverPlan(s, restored.path, oldCwd);

  const notes: string[] = [];
  if (!restored) {
    // Nothing to make a worktree from: the conversation alone, in the project.
    db.prepare(
      `UPDATE sessions SET worktree_path = NULL,
         working_directory = ?, settled_at = NULL, snoozed_until = NULL, snoozed_at = NULL,
         archived_at = NULL, active_at = datetime('now') WHERE id = ?`
    ).run(cwd, s.id);
    setTask(db, s.id, { task_status: null, task_ended_at: null });
    notes.push(
      "its branch and worktree were gone, so only the conversation came back, in the project folder"
    );
  } else {
    db.prepare(
      `UPDATE sessions SET worktree_path = ?, working_directory = ?, settled_at = NULL,
         snoozed_until = NULL, snoozed_at = NULL, archived_at = NULL,
         active_at = datetime('now') WHERE id = ?`
    ).run(restored.path, restored.path, s.id);
    if (restored.mode !== "kept") await setUp(s, repo, restored.path);
    if (restored.mode === "fresh")
      notes.push(
        "its branch was gone: a new one from its base (it had no commits)"
      );
  }

  let reopened: number | null = null;
  if (restored && pr?.state === "CLOSED" && prev === "dropped") {
    try {
      await gitPush(restored.path, ["-u", "origin", s.branch_name!]);
      await run("gh", ["pr", "reopen", String(pr.number)], repo);
      setPr(db, s.id, { pr_status: "open" });
      reopened = pr.number;
    } catch (err) {
      notes.push(
        `PR #${pr.number} stays closed (${(err as Error).message.split("\n")[0]})`
      );
    }
  } else if (pr?.state === "CLOSED")
    notes.push(`PR #${pr.number} stays closed: it wasn't closed by a drop`);

  const after = row(s.id)!;
  if (restored && after.view !== "chat") await relaunch(after, restored.path);
  syncTaskCardInBackground(after, "working", null);
  void dropSnapshot(repo, s.id);
  const swept = sweptNote(s.id);
  if (swept) {
    notes.unshift(swept);
    forgetSwept(s.id);
  }
  const text = `${s.name} is back${restored ? ` in ${restored.path}` : ""}${reopened ? `, PR #${reopened} reopened` : ""}${notes.length ? `; ${notes.join("; ")}` : ""}.`;
  return outcome(s, "task", text, {
    worktree: restored?.mode ?? "chat-only",
    prReopened: reopened,
  });
}

// A plan-only task's plan isn't in git: the snapshot has it, otherwise the
// conversation's own Write of it does.
async function recoverPlan(
  s: Session,
  worktree: string,
  oldCwd: string
): Promise<void> {
  if (fs.existsSync(path.join(worktree, PLAN_FILE))) return;
  if (!s.claude_session_id) return;
  const text = await readTranscript(oldCwd, s.claude_session_id);
  const plan = text && planFromTranscript(text);
  if (!plan) return;
  preparePlanDir(worktree);
  fs.writeFileSync(path.join(worktree, PLAN_FILE), plan);
}

// Ports, its private database and the setup commands, the way a move's
// arrival does. A failure here leaves the worktree usable.
async function setUp(
  s: Session,
  repo: string,
  worktree: string
): Promise<void> {
  try {
    const { config } = loadProjectConfig(repo);
    const { ports } = await allocatePorts(s.id, portBases(config));
    if (config.database) await ensureSessionDatabase(s.id, config.database);
    runInBackground(
      () =>
        setupWorktree({
          worktreePath: worktree,
          sourcePath: repo,
          ports,
          sessionId: s.id,
        }).then(() => {}),
      `setup-restored-${s.id}`
    );
  } catch (err) {
    console.error(`[resurrect] setup for ${s.id}:`, err);
  }
}

// A terminal task's agent is a process, so it's started again on its
// conversation. (A chat's worker starts with its next message.)
async function relaunch(s: Session, cwd: string): Promise<void> {
  await launchClaude({
    sessionId: s.id,
    tmuxName: s.tmux_name,
    cwd,
    model: s.model,
    prompt: s.claude_session_id
      ? "This task was dropped and has been restored. Carry on where you left off."
      : (s.task_prompt ?? ""),
    resume: s.claude_session_id ?? undefined,
    brief: s.branch_name
      ? buildTaskBrief({
          branch: s.branch_name,
          baseBranch: s.base_branch ?? "main",
          test: declaredTest(cwd),
        })
      : undefined,
  });
}
