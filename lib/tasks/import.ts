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
import { allocatePorts } from "../ports";
import { loadProjectConfig, portBases } from "../project-config";
import {
  dropSessionDatabase,
  ensureSessionDatabase,
} from "../project-config/database";
import { runInBackground } from "../async-operations";
import { launchClaude } from "../agents/launch";
import { resolveModelForAgent } from "../model-catalog";
import { buildTaskBrief } from "./brief";
import { expandHome } from "./session";
import { ensureProject } from "./project-ref";
import { checkoutBranchWorktree } from "./branch-worktree";
import { rewritePaths, writeTranscript } from "./transcript";
import { stepProgress } from "./move-progress";
import { dropChat, unpackChat } from "./move-chat";
import { sendChat, stopChat } from "../chat/runner";
import {
  arrivalNote,
  InProgressError,
  validateBundle,
  type TaskBundle,
} from "./move-bundle";

// Imports in flight in this process, by move id.
const g = globalThis as unknown as { __agentosImporting?: Set<string> };
const importing = (g.__agentosImporting ??= new Set());

/** The task a move made here, if it arrived. */
export const arrived = (moveId: string) =>
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
  if (importing.has(bundle.moveId))
    throw new InProgressError("It's arriving already");
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

  stepProgress(bundle.moveId, "worktree");
  const { worktreePath, reused } = await checkoutBranchWorktree(
    projectPath,
    bundle.branch
  );
  const claude = bundle.claude;
  const paths = claude && {
    from: { cwd: claude.cwd, home: claude.home },
    to: { cwd: worktreePath, home: os.homedir() },
  };
  stepProgress(bundle.moveId, "conversation");
  if (claude && paths) {
    await writeTranscript(
      worktreePath,
      claude.sessionId,
      rewritePaths(claude.transcript, paths.from, paths.to)
    );
  }

  const id = randomUUID();
  const tmuxName = `claude-${id}`;
  const model = resolveModelForAgent(
    "claude",
    bundle.model || project.default_model
  );
  const baseBranch = bundle.baseBranch ?? "main";
  const brief = buildTaskBrief({ branch: bundle.branch, baseBranch });
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
    // A chat's worker reads its brief from the row; a terminal's is passed.
    db.prepare(
      `UPDATE sessions SET task_prompt = ?, task_brief = ?, task_status = 'running', name_source = 'user',
         claude_session_id = ?, moved_from = ? WHERE id = ?`
    ).run(bundle.prompt, brief, claude?.sessionId ?? null, bundle.moveId, id);
    if (bundle.chat) unpackChat(id, bundle.chat, paths);
  })();

  stepProgress(bundle.moveId, "resume");
  try {
    // Its ports and database here, then its setup with them: the slot
    // needs the row, and the agent's env is read when it launches.
    const { config } = loadProjectConfig(projectPath);
    const { ports } = await allocatePorts(id, portBases(config));
    if (config.database) await ensureSessionDatabase(id, config.database);
    if (!reused) {
      runInBackground(async () => {
        await setupWorktree({
          worktreePath,
          sourcePath: projectPath,
          ports,
          sessionId: id,
        });
      }, `setup-moved-${bundle.branch}`);
    }
    const prompt = claude
      ? arrivalNote(bundle, worktreePath)
      : `${bundle.prompt}\n\n${arrivalNote(bundle, worktreePath)}`;
    if (bundle.chat) {
      // Its worker starts on the carried conversation, takes the note
      // first, then what was queued.
      await sendChat(id, {
        text: prompt,
        origin: { kind: "system", label: "AgentOS move", body: prompt },
      });
    } else {
      await launchClaude({
        sessionId: id,
        tmuxName,
        cwd: worktreePath,
        model,
        prompt,
        resume: claude?.sessionId,
        brief,
      });
    }
  } catch (err) {
    // Nothing runs here, so the source may resume it: leave no row behind,
    // and no database (the drop reads the row before it goes).
    void dropSessionDatabase(id);
    if (bundle.chat) {
      stopChat(id);
      dropChat(id);
    }
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
    throw err;
  }
  return queries.getSession(db).get(id) as Session;
}
