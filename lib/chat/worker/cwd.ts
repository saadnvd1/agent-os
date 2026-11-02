import fs from "fs";
import os from "os";
import path from "path";
import { getProject } from "../../projects";
import type { Session } from "../../db";

const expand = (p: string) => p.replace(/^~/, os.homedir());
const isDir = (p: string) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

export const WORKTREE_REMOVED_NOTE =
  "(This task's PR merged and its worktree was removed. You are now running in the project's main checkout: do not edit files or commit here. Questions are fine; if more changes are needed, say a follow-up task is required.)";

// The project's own checkout, for a session whose folder is gone; null when
// that is missing too or the session never had a project.
function projectRoot(session: Session): string | null {
  const project = session.project_id ? getProject(session.project_id) : null;
  const root = project ? expand(project.working_directory) : null;
  return root && isDir(root) ? root : null;
}

// Where a session's agent runs. A task's worktree is removed when it
// merges, but its chat can still be asked a question: it runs in the
// project's checkout instead.
export function resolveChatCwd(session: Session): {
  session: Session;
  removedFrom: string | null;
} {
  const dir = expand(session.working_directory);
  if (isDir(dir)) return { session, removedFrom: null };
  const root = projectRoot(session);
  if (!root) return { session, removedFrom: null };
  return {
    session: { ...session, working_directory: root },
    removedFrom: dir,
  };
}

// Claude finds a conversation under its folder's name in its config dir, so
// a resume from a new folder needs the transcript copied there.
export function carryClaudeTranscript(
  from: string,
  to: string,
  claudeSessionId: string | null
): void {
  if (!claudeSessionId) return;
  const base = path.join(
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
    "projects"
  );
  const name = (d: string) => d.replace(/[^a-zA-Z0-9]/g, "-");
  const src = path.join(base, name(from), `${claudeSessionId}.jsonl`);
  const dest = path.join(base, name(to), `${claudeSessionId}.jsonl`);
  try {
    if (!fs.existsSync(src) || fs.existsSync(dest)) return;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  } catch (error) {
    console.error(
      "Couldn't carry the transcript to the project folder:",
      error
    );
  }
}

// A finished task whose worktree is gone: the sidebar's cue for the notice.
export function worktreeRemoved(session: Session): boolean {
  if (!session.worktree_path || !session.task_status) return false;
  if (session.task_status === "running") return false;
  if (session.host_id && session.host_id !== "local") return false;
  return !isDir(expand(session.worktree_path));
}
