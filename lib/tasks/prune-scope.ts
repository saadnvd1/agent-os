import { getProject } from "../projects";
import { repoSlug } from "../git-remote";
import { scopeProjectIds, type DoneScope } from "../done/bulk";
import { expandHome } from "./session";
import type { PruneRepo } from "./prune-branches";

// The scope's local GitHub clones, one entry per repository (projects that
// share one are merged, so its branches are listed once).
export async function prunableRepos(scope: DoneScope): Promise<PruneRepo[]> {
  const bySlug = new Map<string, PruneRepo>();
  for (const id of scopeProjectIds(scope)) {
    const p = getProject(id);
    if (!p || (p.host_id && p.host_id !== "local")) continue;
    const dir = expandHome(p.working_directory);
    const slug = await repoSlug(dir);
    if (!slug) continue;
    const hit = bySlug.get(slug);
    if (hit) hit.projectIds.push(id);
    else bySlug.set(slug, { dir, slug, projectIds: [id] });
  }
  return [...bySlug.values()];
}
