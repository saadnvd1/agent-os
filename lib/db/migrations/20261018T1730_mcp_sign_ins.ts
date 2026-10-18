import type { Migration } from "../migration-types";

export default {
  key: "20261018T1730_mcp_sign_ins",
  up: (db) => {
    // MCP sign-ins waiting for the provider to send the browser back, keyed by
    // the OAuth state. Short-lived and single use; no tokens are stored.
    // Additive.
    db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_sign_ins (
        state TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        server TEXT NOT NULL,
        origin TEXT,
        at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mcp_sign_ins_session
        ON mcp_sign_ins(session_id, server);
    `);
  },
} satisfies Migration;
