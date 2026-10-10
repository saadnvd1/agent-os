// Which GitHub repository a folder is a clone of ("owner/repo", lower
// case), read from its origin's URL as configured, with no gh call. A PR
// and a foreign session belong to a workspace when their repository is one
// of its projects'.

import type { Project } from "../db";
import { run } from "../tasks/gh";
import { expandHome } from "../tasks/session";
import { workspaceProjects } from "./brief";

const GITHUB_REMOTE =
  /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/:]+@)github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

export function slugOfRemote(url: string | null | undefined): string | null {
  const m = GITHUB_REMOTE.exec((url ?? "").trim());
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

// A remote's URL doesn't change under a running server often enough to ask
// git on every lookup.
const SLUG_TTL_MS = 5 * 60 * 1000;
const slugs = new Map<string, { at: number; slug: string | null }>();

export async function repoSlug(dir: string): Promise<string | null> {
  const hit = slugs.get(dir);
  if (hit && Date.now() - hit.at < SLUG_TTL_MS) return hit.slug;
  const url = await run(
    "git",
    ["config", "--get", "remote.origin.url"],
    dir,
    10000
  ).catch(() => "");
  const slug = slugOfRemote(url);
  slugs.set(dir, { at: Date.now(), slug });
  return slug;
}

export interface WorkspaceRepo {
  project: Project;
  dir: string;
  slug: string;
}

// The workspace's projects that are GitHub clones on this machine: the ones
// whose PRs can be fetched, diffed and merged from here.
export async function workspaceRepos(
  workspaceId: string
): Promise<WorkspaceRepo[]> {
  const local = workspaceProjects(workspaceId).filter(
    (p) => !p.host_id || p.host_id === "local"
  );
  const found = await Promise.all(
    local.map(async (project) => {
      const dir = expandHome(project.working_directory);
      const slug = await repoSlug(dir);
      return slug ? { project, dir, slug } : null;
    })
  );
  return found.filter((r): r is WorkspaceRepo => !!r);
}
