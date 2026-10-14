import type { Migration } from "../migration-types";

export default {
  id: 47,
  name: "pin_orchestrators",
  up: (db) => {
    // A workspace's orchestrator starts pinned to the top of its list;
    // unpinning it is then remembered on the session, which lives as
    // long as its workspace.
    db.exec(`UPDATE sessions SET pinned = 1 WHERE role = 'orchestrator'`);
  },
} satisfies Migration;
