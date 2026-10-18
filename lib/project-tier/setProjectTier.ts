import { getProject } from "@/lib/projects";
import { db } from "@/lib/db";
import type { Project } from "@/lib/db/types";
import type { ProjectTier } from "./types";

export function setProjectTier(projectId: string, tier: ProjectTier): Project {
  const project = getProject(projectId);
  if (!project || project.is_uncategorized)
    throw new Error("Project not found or cannot be modified");
  db.prepare(
    `UPDATE projects SET tier = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(tier, projectId);
  return getProject(projectId)!;
}
