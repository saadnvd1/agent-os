import { db } from "../db";
import { withFresh } from "../chat/commands";
import { cachedCommands } from "../chat/settings";
import { VOICE_LIMITS } from "../config/client-config-types";
import { looksSecret } from "../notify/redact";
import { getOrchestrator } from "../orchestrator/home";

const MAX_PHRASE_CHARS = 40;

// Words the phone's recogniser gets wrong without help.
export const FIXED_PHRASES = [
  "orchestrator",
  "worktree",
  "TestFlight",
  "merge",
  "PR",
  "pull request",
  "rebase",
  "ship it",
  "approve",
  "review",
  "deploy",
  "AgentOS",
];

const spoken = (name: string) =>
  name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();

/** Names worth teaching the speech recogniser, most relevant first. */
export function vocabFor(workspaceId: string): string[] {
  const names = (sql: string, ...args: string[]) =>
    (db.prepare(sql).all(...args) as { name: string }[]).map((r) => r.name);

  const workspace = names(
    `SELECT name FROM workspaces WHERE id = ?`,
    workspaceId
  );
  const projects = names(
    `SELECT p.name FROM projects p
     LEFT JOIN sessions s ON s.project_id = p.id
     WHERE p.workspace_id = ?
     GROUP BY p.id
     ORDER BY MAX(COALESCE(s.active_at, s.updated_at)) DESC`,
    workspaceId
  );
  const sessions = names(
    `SELECT s.name FROM sessions s
     JOIN projects p ON p.id = s.project_id
     WHERE p.workspace_id = ?
       AND (s.task_status IS NULL OR s.task_status NOT IN ('merged','dropped','done','moved'))
     ORDER BY COALESCE(s.active_at, s.updated_at) DESC`,
    workspaceId
  );
  const others = names(
    `SELECT name FROM workspaces WHERE id != ? ORDER BY sort_order, created_at`,
    workspaceId
  );
  const orchestrator = getOrchestrator(workspaceId);
  const commands = orchestrator
    ? withFresh(cachedCommands(orchestrator)).map((c) => c.name)
    : withFresh([]).map((c) => c.name);

  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const raw of [
    ...workspace,
    ...projects,
    ...(orchestrator ? [orchestrator.name] : []),
    ...sessions,
    ...others,
    ...commands,
    ...FIXED_PHRASES,
  ]) {
    const p = spoken(raw);
    const key = p.toLowerCase();
    if (!p || p.length > MAX_PHRASE_CHARS || seen.has(key) || looksSecret(raw))
      continue;
    seen.add(key);
    phrases.push(p);
    if (phrases.length >= VOICE_LIMITS.maxPhrases) break;
  }
  return phrases;
}
