import type { Migration } from "../migration-types";

export default {
  id: 61,
  name: "model_routing",
  // One transaction, so a crash part-way leaves nothing to skip as
  // "duplicate column" on the next start.
  up: (db) =>
    db.transaction(() => {
      // What a session runs on beyond the model name: its provider (NULL is
      // Anthropic), a task's own models by role (JSON), and a task's plan
      // step (planning, then implementing). Each turn keeps the model,
      // provider and role it ran as, how long it took, and the plan's 5-hour
      // window when it ended, so spend compares by model. A check run keeps the
      // provider its model came from.
      for (const col of [
        `ALTER TABLE sessions ADD COLUMN model_provider TEXT`,
        `ALTER TABLE sessions ADD COLUMN model_overrides TEXT`,
        `ALTER TABLE sessions ADD COLUMN plan_phase TEXT`,
        `ALTER TABLE task_queue ADD COLUMN model_overrides TEXT`,
        `ALTER TABLE chat_turns ADD COLUMN model TEXT`,
        `ALTER TABLE chat_turns ADD COLUMN provider TEXT`,
        `ALTER TABLE chat_turns ADD COLUMN role TEXT`,
        `ALTER TABLE chat_turns ADD COLUMN duration_ms INTEGER`,
        `ALTER TABLE chat_turns ADD COLUMN window_pct REAL`,
        `ALTER TABLE check_runs ADD COLUMN provider TEXT`,
      ])
        db.exec(col);
    })(),
} satisfies Migration;
