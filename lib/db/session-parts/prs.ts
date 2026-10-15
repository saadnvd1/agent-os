import type Database from "better-sqlite3";
import type { Session } from "@/lib/db/types";
import type { PartPatch } from "./columns";
import { writePart, type When } from "./write";

// A session's PR and the merge and rebase state kept for it.
export const setPr = (
  db: Database.Database,
  sessionId: string,
  patch: PartPatch<"session_prs">,
  when?: When<"session_prs">
): boolean => writePart(db, "session_prs", sessionId, patch, when);

// A PR found for the session: its link, number and state, and the session
// counts as touched.
export function recordPr(
  db: Database.Database,
  sessionId: string,
  pr: { url: string; number: number; state: string }
): void {
  db.transaction(() => {
    setPr(db, sessionId, {
      pr_url: pr.url,
      pr_number: pr.number,
      pr_status: pr.state as Session["pr_status"],
    });
    db.prepare(
      `UPDATE sessions SET updated_at = datetime('now') WHERE id = ?`
    ).run(sessionId);
  })();
}
