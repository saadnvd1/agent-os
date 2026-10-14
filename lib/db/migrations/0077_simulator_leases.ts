import type { Migration } from "../migration-types";

export default {
  id: 77,
  name: "simulator_leases",
  up: (db) => {
    // One iOS simulator a task holds (lib/simulator): the device AgentOS
    // made for it, and where it is in coming up.
    db.exec(
      `CREATE TABLE IF NOT EXISTS simulator_leases (
           session_id TEXT PRIMARY KEY,
           udid TEXT,
           name TEXT NOT NULL,
           state TEXT NOT NULL,
           error TEXT,
           created_at INTEGER NOT NULL,
           last_used_at INTEGER NOT NULL
         )`
    );
  },
} satisfies Migration;
