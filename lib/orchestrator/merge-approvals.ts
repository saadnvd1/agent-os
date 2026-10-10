/**
 * Whether Saad approves sensitive or large PRs himself before they merge.
 * Off (the default), they merge through the gates like any other PR, and a
 * diff too big to read whole is reviewed in parts. On, they go to his asks
 * list whatever the gates say and merge only on his approval of the commit.
 * App-wide, switched in Settings → Devices.
 */

import { db } from "../db";

const KEY = "orchestrator.merge_approvals";

// The escalations this switch decides. A gate failing twice, or a repo with
// no CI, goes to Saad either way.
export const APPROVAL_GATES: readonly string[] = ["sensitive", "size"];

export function mergeApprovalsOn(): boolean {
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(KEY) as { value: string } | undefined;
  return row?.value === "1";
}

export function setMergeApprovals(on: boolean): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(KEY, on ? "1" : "0");
}
