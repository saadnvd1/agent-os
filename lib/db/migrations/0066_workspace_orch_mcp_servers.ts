import type { Migration } from "../migration-types";

export default {
  id: 66,
  name: "workspace_orch_mcp_servers",
  up: (db) => {
    // The MCP servers (by name) a workspace's orchestrator may use.
    const columns = db.prepare(`PRAGMA table_info(workspaces)`).all() as {
      name: string;
    }[];
    if (!columns.some((c) => c.name === "orch_mcp_servers"))
      db.exec(
        `ALTER TABLE workspaces ADD COLUMN orch_mcp_servers TEXT NOT NULL DEFAULT '["linear"]'`
      );
  },
} satisfies Migration;
