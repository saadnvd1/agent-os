import fs from "fs";
import os from "os";
import path from "path";
import { db } from "../db";
import { getHq } from "../session-logs/hq";
import { expand, repoPaths, resolved } from "../session-logs/paths";
import type { MentionRoot } from "./files";

// HQ and seven repositories: more than a workspace has, and a bound on
// what an "@" indexes.
const MAX_ROOTS = 8;

function isFolder(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

// Where an orchestrator's "@" looks: the workspace's HQ, then each local
// project's repositories. Null for any other session, whose picker keeps
// searching its own folder. The orchestrator's scratch folder holds its own
// working notes, not what's pointed at, so it's searched only when nothing
// else is there.
export function mentionRoots(sessionId: string): MentionRoot[] | null {
  const session = db
    .prepare(
      `SELECT role, workspace_id, working_directory FROM sessions WHERE id = ?`
    )
    .get(sessionId) as
    | {
        role: string | null;
        workspace_id: string | null;
        working_directory: string;
      }
    | undefined;
  if (session?.role !== "orchestrator") return null;

  // Never the home folder or the whole disk: a project pointed there would
  // list everything under it, dotfiles and keys included.
  const refused = new Set([
    path.parse(os.homedir()).root,
    resolved(os.homedir()),
  ]);
  const found: MentionRoot[] = [];
  const add = (dir: string, label: string, hq: boolean, needsGit = false) => {
    if (found.length >= MAX_ROOTS || refused.has(dir) || !isFolder(dir)) return;
    if (needsGit && !fs.existsSync(path.join(dir, ".git"))) return;
    if (found.some((r) => r.dir === dir)) return;
    const taken = found.some((r) => r.label === label);
    found.push({
      dir,
      label: taken ? `${label}/${path.basename(dir)}` : label,
      hq,
    });
  };

  const workspaceId = session.workspace_id;
  if (workspaceId) {
    const hq = getHq(workspaceId);
    if (hq) add(resolved(expand(hq.folder)), "HQ", true, true);
    const projects = db
      .prepare(
        `SELECT id, name FROM projects
         WHERE workspace_id = ? AND host_id = 'local' AND is_uncategorized = 0
         ORDER BY sort_order, name`
      )
      .all(workspaceId) as { id: string; name: string }[];
    for (const project of projects)
      repoPaths(project.id).forEach((dir, i) =>
        add(dir, i === 0 ? project.name : path.basename(dir), false)
      );
  }
  if (!found.length) {
    const scratch = resolved(expand(session.working_directory));
    return [{ dir: scratch, label: "scratch", hq: false }];
  }
  return found;
}
