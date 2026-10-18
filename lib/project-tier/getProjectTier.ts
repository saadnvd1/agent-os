import { db } from "@/lib/db";
import type { ProjectTier } from "./types";

// An unknown project counts as production: a missing row never opens the
// fast lane.
export function projectTier(projectId: string | null): ProjectTier {
  if (!projectId) return "production";
  const row = db
    .prepare(`SELECT tier FROM projects WHERE id = ?`)
    .get(projectId) as { tier: string } | undefined;
  return row?.tier === "fast" ? "fast" : "production";
}

export const taskTier = (task: { project_id: string | null }): ProjectTier =>
  projectTier(task.project_id);

export const isFast = (task: { project_id: string | null }): boolean =>
  taskTier(task) === "fast";
