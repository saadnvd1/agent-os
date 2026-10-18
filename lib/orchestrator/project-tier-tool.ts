import {
  PROJECT_TIERS,
  setProjectTier,
  type ProjectTier,
} from "../project-tier";
import { addNote } from "./notes";
import { workspaceProjects } from "./brief";
import { workspaceProject } from "./targets";

const line = (name: string, tier: ProjectTier) =>
  `- ${name}: ${tier}${tier === "fast" ? " (merges when its PR opens)" : " (CI, review and scope gate its merges)"}`;

// project_tier: read one project's tier, or all of the workspace's; with a
// tier, set it (Saad's call: only when he says so).
export function projectTierTool(
  workspaceId: string,
  projectRef?: string,
  tier?: (typeof PROJECT_TIERS)[number]
): string {
  if (!projectRef) {
    if (tier) throw new Error("Say which project to set");
    const all = workspaceProjects(workspaceId);
    return all.length
      ? all.map((p) => line(p.name, p.tier)).join("\n")
      : "No projects in this workspace.";
  }
  const project = workspaceProject(workspaceId, projectRef);
  if (!tier) return line(project.name, project.tier);
  if (tier === project.tier) return line(project.name, project.tier);
  setProjectTier(project.id, tier);
  addNote(workspaceId, `Set ${project.name} to ${tier}.`);
  return `Set ${project.name} to ${tier}.\n${line(project.name, tier)}`;
}
