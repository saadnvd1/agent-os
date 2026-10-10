/**
 * A new session's worktree, built after its first send: fetch, worktree on a
 * temporary branch, branch renamed from the first message, env files, deps,
 * setup script. The first message waits in the chat queue meanwhile, so the
 * agent never starts on half-installed dependencies and a restart loses
 * nothing.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { db } from "../db";
import { createWorktree } from "../worktrees";
import { setupWorktree } from "../env-setup";
import {
  generateBranchName,
  getDefaultBranch,
  isBranchName,
  renameBranch,
} from "../git";
import { allocatePorts } from "../ports";
import { loadProjectConfig, portBases } from "../project-config";
import { notifySessionsChanged } from "../status/hub";
import {
  recordSetup,
  setupNote,
  setupOutcome,
  type TaskSetup,
} from "../tasks/setup";
import { draftFeature, featureFromTitle } from "./branch";
import {
  enterStage,
  finishSetup,
  logStep,
  startSetup,
  type SetupView,
} from "./setup-progress";

const execFileAsync = promisify(execFile);

export interface WorktreeSetupInput {
  sessionId: string;
  projectPath: string;
  // null: the project's default branch.
  baseBranch: string | null;
  // Resolves to the session's title once it has one (or null), for the
  // branch name.
  title: Promise<string | null>;
  // Runs once setup is over, with a note for the agent when it failed.
  onReady: (note: string) => Promise<void>;
}

const git = (cwd: string, args: string[], timeout = 60_000) =>
  execFileAsync("git", ["-C", cwd, ...args], { timeout });

// No remote: nothing to fetch. A fetch that fails fails the setup: a
// worktree cut from an old base would start the agent on stale code.
async function fetchBase(view: SetupView, cwd: string, base: string) {
  enterStage(view, "fetch");
  try {
    await git(cwd, ["remote", "get-url", "origin"], 5_000);
  } catch {
    return;
  }
  try {
    await git(cwd, ["fetch", "origin", "--", base]);
  } catch (error) {
    const why = (
      (error as Error).message.trim().split("\n").pop() ?? ""
    ).replace(/^fatal: /, "");
    throw new Error(`Fetching ${base} failed: ${why}`);
  }
}

async function renameFromTitle(
  view: SetupView,
  input: WorktreeSetupInput,
  worktreePath: string,
  from: string
): Promise<void> {
  const title = await input.title.catch(() => null);
  if (!title) return;
  const to = generateBranchName(featureFromTitle(title, input.sessionId));
  if (to === from) return;
  try {
    await renameBranch(worktreePath, from, to);
    db.prepare(`UPDATE sessions SET branch_name = ? WHERE id = ?`).run(
      to,
      input.sessionId
    );
    view.branch = to;
  } catch (error) {
    // The temporary name is a fine name.
    console.warn(`[launch] branch not renamed: ${(error as Error).message}`);
  }
}

export async function setUpWorktree(input: WorktreeSetupInput): Promise<void> {
  const { sessionId, projectPath } = input;
  const feature = draftFeature(sessionId);
  const view = startSetup(sessionId, generateBranchName(feature));
  let setup: TaskSetup;
  try {
    const baseBranch =
      input.baseBranch ?? (await getDefaultBranch(projectPath));
    if (!isBranchName(baseBranch))
      throw new Error(`"${baseBranch}" isn't a branch name`);
    await fetchBase(view, projectPath, baseBranch);
    enterStage(view, "worktree");
    const wt = await createWorktree({
      projectPath,
      featureName: feature,
      baseBranch,
    });
    db.prepare(
      `UPDATE sessions SET worktree_path = ?, branch_name = ?, base_branch = ? WHERE id = ?`
    ).run(wt.worktreePath, wt.branchName, baseBranch, sessionId);
    const { ports } = await allocatePorts(
      sessionId,
      portBases(loadProjectConfig(projectPath).config)
    );
    notifySessionsChanged();

    const [result] = await Promise.all([
      setupWorktree({
        worktreePath: wt.worktreePath,
        sourcePath: projectPath,
        ports,
        progress: {
          onStage: (stage) => enterStage(view, stage),
          onStep: (step) => logStep(view, step),
        },
      }).catch((error: unknown) =>
        error instanceof Error ? error : new Error(String(error))
      ),
      renameFromTitle(view, input, wt.worktreePath, wt.branchName),
    ]);
    setup = setupOutcome(result);
  } catch (error) {
    // No worktree: the agent doesn't start. Its message stays queued, and
    // the session falls back to the project's folder if sent anyway.
    // git's own last line says it best ("not a git repository ...").
    const message = (error instanceof Error ? error.message : String(error))
      .trim()
      .split("\n")
      .pop()!
      .replace(/^fatal: /, "");
    db.prepare(`UPDATE sessions SET working_directory = ? WHERE id = ?`).run(
      projectPath,
      sessionId
    );
    finishSetup(sessionId, view, message);
    recordSetup(db, sessionId, { status: "failed", ms: null, error: message });
    notifySessionsChanged();
    return;
  }
  finishSetup(sessionId, view, setup.status === "failed" ? setup.error : null);
  recordSetup(db, sessionId, setup);
  notifySessionsChanged();
  await input.onReady(setupNote(setup));
}

// A session's setup this server was running when it stopped: the agent never
// started, and its first message is still queued for Send now, in the
// worktree if it was made, else the project's folder.
export function failInterruptedSetups(): number {
  return db
    .prepare(
      `UPDATE sessions SET setup_status = 'failed',
         working_directory = CASE WHEN worktree_path IS NULL
           THEN COALESCE((SELECT working_directory FROM projects WHERE id = sessions.project_id), working_directory)
           ELSE working_directory END,
         setup_error = 'AgentOS restarted before setup finished. Your message is still queued: send it when you are ready.'
       WHERE setup_status = 'running' AND task_status IS NULL`
    )
    .run().changes;
}
