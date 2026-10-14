// Which GitHub repository a folder is a clone of ("owner/repo", lower
// case), read from its origin's URL as configured, with no gh call. A PR
// and a foreign session belong to a workspace when their repository is one
// of its projects'.

import type { Project } from "../db";
import { expandHome } from "../tasks/session";
import { workspaceProjects } from "./brief";
import { repoSlug } from "../git-remote";

export { repoSlug, repoSlugSync, slugOfRemote } from "../git-remote";

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
