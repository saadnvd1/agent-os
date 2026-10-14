import type { Migration } from "../migration-types";

export default {
  id: 6,
  name: "add_orchestration_columns_to_sessions",
  up: (db) => {
    db.exec(
      `ALTER TABLE sessions ADD COLUMN conductor_session_id TEXT REFERENCES sessions(id)`
    );
    db.exec(`ALTER TABLE sessions ADD COLUMN worker_task TEXT`);
    db.exec(`ALTER TABLE sessions ADD COLUMN worker_status TEXT`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_sessions_conductor ON sessions(conductor_session_id)`
    );
  },
} satisfies Migration;
