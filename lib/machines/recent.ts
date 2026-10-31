import { getDb } from "../db";
import type { AgentType } from "../providers";
import type { RecentPick } from "./types";

const LIMIT = 8;

/**
 * The agent and model the latest sessions in a project ran with here, newest
 * first and each pair once. Roles pick their own models, so they don't count.
 */
export function recentPicks(projectId: string | null): RecentPick[] {
  if (!projectId) return [];
  const rows = getDb()
    .prepare(
      `SELECT agent_type, model FROM sessions
       WHERE project_id = ? AND host_id = 'local' AND agent_role IS NULL
         AND model IS NOT NULL AND model != ''
       ORDER BY created_at DESC, rowid DESC LIMIT 100`
    )
    .all(projectId) as { agent_type: string; model: string }[];
  const seen = new Set<string>();
  const picks: RecentPick[] = [];
  for (const r of rows) {
    const key = `${r.agent_type}\0${r.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push({ agent: r.agent_type as AgentType, model: r.model });
    if (picks.length === LIMIT) break;
  }
  return picks;
}
