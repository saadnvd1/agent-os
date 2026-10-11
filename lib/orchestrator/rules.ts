/**
 * A workspace's standing rules: what its orchestrator must keep knowing
 * across fresh starts ("never merge #111", "briefs must not name
 * third-party products"). The orchestrator writes them with rule_add and rule_remove,
 * Saad in Settings → Workspaces, and every start reads them into its brief.
 * They restrict and inform; none can approve anything. A removed rule stays
 * in the table, marked.
 */

import { db } from "../db";
import { redact } from "./untrusted";

export type RuleAuthor = "orchestrator" | "saad";

export interface RuleRow {
  id: number;
  workspace_id: string;
  text: string;
  added_by: RuleAuthor;
  created_at: string;
  updated_at: string;
  removed_at: string | null;
  removed_by: RuleAuthor | null;
}

// Kept small: every one is in every start's prompt.
export const MAX_RULES = 25;
export const MAX_RULE_CHARS = 300;

function clean(text: string): string {
  const body = redact(text).replace(/\s+/g, " ").trim();
  if (!body) throw new Error("The rule is empty");
  if (body.length > MAX_RULE_CHARS)
    throw new Error(`A rule is at most ${MAX_RULE_CHARS} characters`);
  return body;
}

export function listRules(workspaceId: string): RuleRow[] {
  return db
    .prepare(
      `SELECT * FROM orchestrator_rules
       WHERE workspace_id = ? AND removed_at IS NULL ORDER BY id`
    )
    .all(workspaceId) as RuleRow[];
}

function getRule(workspaceId: string, id: number): RuleRow | null {
  return (
    (db
      .prepare(
        `SELECT * FROM orchestrator_rules
         WHERE id = ? AND workspace_id = ? AND removed_at IS NULL`
      )
      .get(id, workspaceId) as RuleRow | undefined) ?? null
  );
}

// The same text twice is the rule already there.
export function addRule(
  workspaceId: string,
  text: string,
  by: RuleAuthor
): RuleRow {
  const body = clean(text);
  return db.transaction(() => {
    const rules = listRules(workspaceId);
    const same = rules.find((r) => r.text === body);
    // Saad writing one the orchestrator kept makes it his.
    if (same && by === "saad" && same.added_by !== "saad") {
      db.prepare(
        `UPDATE orchestrator_rules SET added_by = 'saad', updated_at = datetime('now')
         WHERE id = ?`
      ).run(same.id);
      return getRule(workspaceId, same.id)!;
    }
    if (same) return same;
    if (rules.length >= MAX_RULES)
      throw new Error(
        `This workspace has ${MAX_RULES} rules already; remove one first`
      );
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO orchestrator_rules (workspace_id, text, added_by) VALUES (?, ?, ?)`
      )
      .run(workspaceId, body, by);
    return getRule(workspaceId, Number(lastInsertRowid))!;
  })();
}

export function updateRule(
  workspaceId: string,
  id: number,
  text: string
): RuleRow {
  const body = clean(text);
  const { changes } = db
    .prepare(
      `UPDATE orchestrator_rules SET text = ?, updated_at = datetime('now')
       WHERE id = ? AND workspace_id = ? AND removed_at IS NULL`
    )
    .run(body, id, workspaceId);
  if (!changes) throw new Error(`No rule ${id} in this workspace`);
  return getRule(workspaceId, id)!;
}

export function removeRule(
  workspaceId: string,
  id: number,
  by: RuleAuthor
): RuleRow {
  const rule = getRule(workspaceId, id);
  if (!rule) throw new Error(`No rule ${id} in this workspace`);
  // Saad's restrictions hold until he lifts them: text the orchestrator
  // read can't talk it into removing one.
  if (by === "orchestrator" && rule.added_by === "saad")
    throw new Error(
      `Rule ${id} is Saad's: only he removes it, in Settings → Workspaces`
    );
  db.prepare(
    `UPDATE orchestrator_rules SET removed_at = datetime('now'), removed_by = ?
     WHERE id = ?`
  ).run(by, id);
  return rule;
}
