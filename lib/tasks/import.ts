/**
 * The arriving half of a move: this machine's project for the bundle (cloned
 * if it must be), the branch's worktree, the conversation under this
 * machine's paths, and the agent resumed on it. Importing the same move
 * again returns the task it made the first time.
 */

import os from "os";
import { randomUUID } from "crypto";
import { db, queries, type Session } from "../db";
import { setupWorktree } from "../env-setup";
import { runInBackground } from "../async-operations";
import { launchClaude } from "../agents/launch";
import { resolveModelForAgent } from "../model-catalog";
import { buildTaskBrief } from "./brief";
import { expandHome } from "./session";
import { ensureProject } from "./project-ref";
import { checkoutBranchWorktree } from "./branch-worktree";
import { rewritePaths, writeTranscript } from "./transcript";
import { arrivalNote, validateBundle, type TaskBundle } from "./move-bundle";

// Imports in flight in this process, by move id.
const g = globalThis as unknown as { __agentosImporting?: Set<string> };
const importing = (g.__agentosImporting ??= new Set());

const arrived = (moveId: string) =>
  db
    .prepare(
      `SELECT * FROM sessions WHERE moved_from = ? AND host_id = 'local'
         AND task_status IN ('running', 'moving', 'moved', 'merged', 'done')`
    )
    .get(moveId) as Session | undefined;

// A mirror of the task on the machine it's leaving doesn't count.
function refuseBusyBranch(projectId: string, branch: string): void {
  const busy = db
    .prepare(
      `SELECT id FROM sessions WHERE project_id = ? AND branch_name = ?
         AND task_status IN ('running', 'moving') AND host_id = 'local'`
    )
    .get(projectId, branch);
  if (busy) throw new Error(`${branch} already has a task running here`);
}

export async function importTask(input: TaskBundle): Promise<Session> {
  const bundle = validateBundle(input);
  const done = arrived(bundle.moveId);
  if (done) return done;
  if (importing.has(bundle.moveId)) throw new Error("It's arriving already");
  importing.add(bundle.moveId);
  try {
    return await arrive(bundle);
  } finally {
    importing.delete(bundle.moveId);
  }
}

async function arrive(bundle: TaskBundle): Promise<Session> {
  const project = await ensureProject(bundle.project);
  const projectPath = expandHome(project.working_directory);
  refuseBusyBranch(project.id, bundle.branch);

  const { worktreePath, reused } = await checkoutBranchWorktree(
    projectPath,
    bundle.branch
  );
  if (!reused) {
    runInBackground(async () => {
      await setupWorktree({ worktreePath, sourcePath: projectPath });
    }, `setup-moved-${bundle.branch}`);
  }
  const claude = bundle.claude;
  if (claude) {
    await writeTranscript(
      worktreePath,
      claude.sessionId,
      rewritePaths(
        claude.transcript,
        { cwd: claude.cwd, home: claude.home },
        { cwd: worktreePath, home: os.homedir() }
      )
    );
  }

  const id = randomUUID();
  const tmuxName = `claude-${id}`;
  const model = resolveModelForAgent(
    "claude",
    bundle.model || project.default_model
  );
  const baseBranch = bundle.baseBranch ?? "main";
  // Checked and written with no await between, so two can't both pass.
  db.transaction(() => {
    refuseBusyBranch(project.id, bundle.branch);
    queries
      .createSession(db)
      .run(
        id,
        bundle.name,
        tmuxName,
        worktreePath,
        null,
        model,
        null,
        "sessions",
        "claude",
        1,
        project.id,
        "local"
      );
    queries
      .updateSessionWorktree(db)
      .run(worktreePath, bundle.branch, baseBranch, null, id);
    db.prepare(
      `UPDATE sessions SET task_prompt = ?, task_status = 'running', name_source = 'user',
         claude_session_id = ?, moved_from = ? WHERE id = ?`
    ).run(bundle.prompt, claude?.sessionId ?? null, bundle.moveId, id);
  })();

  try {
    await launchClaude({
      sessionId: id,
      tmuxName,
      cwd: worktreePath,
      model,
      prompt: claude
        ? arrivalNote(bundle, worktreePath)
        : `${bundle.prompt}\n\n${arrivalNote(bundle, worktreePath)}`,
      resume: claude?.sessionId,
      brief: buildTaskBrief({ branch: bundle.branch, baseBranch }),
    });
  } catch (err) {
    // Nothing runs here, so the source may resume it: leave no row behind.
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
    throw err;
  }
  return queries.getSession(db).get(id) as Session;
}
