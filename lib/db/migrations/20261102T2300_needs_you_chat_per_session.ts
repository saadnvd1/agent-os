import type { Migration } from "../migration-types";

export default {
  key: "20261102T2300_needs_you_chat_per_session",
  up: (db) => {
    // The Needs-you "waiting in chat" item was keyed per workspace
    // (approval:<workspace id>), so one lead's waiting chat would hide
    // another's. It is keyed per session now; a hidden one stays hidden on
    // the workspace's orchestrator, the only chat that showed it. Safe to
    // repeat: a renamed key no longer matches.
    db.exec(`
      UPDATE OR IGNORE needs_you_dismissed
         SET key = 'approval:' || (
           SELECT s.id FROM sessions s
            WHERE s.role = 'orchestrator'
              AND s.workspace_id = needs_you_dismissed.workspace_id)
       WHERE key = 'approval:' || workspace_id
         AND EXISTS (
           SELECT 1 FROM sessions s
            WHERE s.role = 'orchestrator'
              AND s.workspace_id = needs_you_dismissed.workspace_id)
    `);
  },
} satisfies Migration;
