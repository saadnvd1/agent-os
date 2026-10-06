import type Database from "better-sqlite3";

export type StackStatus =
  | "running"
  | "paused"
  | "landing"
  | "landed"
  | "failed";

export type StackItemStatus =
  | "planned"
  | "held"
  | "starting"
  | "running"
  | "pr"
  | "merged"
  | "failed"
  | "dropped";

export interface StackRow {
  id: string;
  project_id: string;
  lh_board_id: string;
  name: string;
  status: StackStatus;
  max_parallel: number;
  progress: string | null;
  error: string | null;
  created_at: string;
  landed_at: string | null;
}

export interface StackItemRow {
  id: string;
  stack_id: string;
  position: number;
  lh_card_id: string;
  ticket: string | null;
  title: string;
  parent_item_id: string | null;
  also_item_ids: string;
  blocker_item_ids: string;
  status: StackItemStatus;
  session_id: string | null;
  base_branch: string | null;
  base_tip: string | null;
  pr_number: number | null;
  note: string | null;
  error: string | null;
  attempts: number;
  // Held by the plan (an open blocker outside the stack): a retry keeps it.
  held_outside: number;
}

export type NewStackItem = Omit<
  StackItemRow,
  "stack_id" | "pr_number" | "error" | "attempts"
>;

type ItemPatch = Partial<
  Pick<
    StackItemRow,
    | "status"
    | "session_id"
    | "base_branch"
    | "base_tip"
    | "pr_number"
    | "note"
    | "error"
    | "attempts"
  >
>;

type StackPatch = Partial<
  Pick<StackRow, "status" | "progress" | "error" | "landed_at">
>;

function update(
  db: Database.Database,
  table: "stacks" | "stack_items",
  id: string,
  patch: Record<string, unknown>
) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  db.prepare(
    `UPDATE ${table} SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`
  ).run({ ...patch, id });
}

export const stackQueries = {
  create: (
    db: Database.Database,
    stack: Pick<
      StackRow,
      "id" | "project_id" | "lh_board_id" | "name" | "max_parallel"
    >,
    items: NewStackItem[]
  ) =>
    db.transaction(() => {
      db.prepare(
        `INSERT INTO stacks (id, project_id, lh_board_id, name, max_parallel)
         VALUES (@id, @project_id, @lh_board_id, @name, @max_parallel)`
      ).run(stack);
      const insert = db.prepare(
        `INSERT INTO stack_items (id, stack_id, position, lh_card_id, ticket, title,
           parent_item_id, also_item_ids, blocker_item_ids, status, session_id,
           base_branch, base_tip, note, held_outside)
         VALUES (@id, @stack_id, @position, @lh_card_id, @ticket, @title,
           @parent_item_id, @also_item_ids, @blocker_item_ids, @status, @session_id,
           @base_branch, @base_tip, @note, @held_outside)`
      );
      for (const item of items) insert.run({ ...item, stack_id: stack.id });
    })(),

  all: (db: Database.Database) =>
    db
      .prepare(`SELECT * FROM stacks ORDER BY created_at DESC`)
      .all() as StackRow[],

  get: (db: Database.Database, id: string) =>
    (db.prepare(`SELECT * FROM stacks WHERE id = ?`).get(id) as
      | StackRow
      | undefined) ?? null,

  // The board's stack that has not finished yet, if any.
  openForBoard: (db: Database.Database, boardId: string) =>
    (db
      .prepare(
        `SELECT * FROM stacks WHERE lh_board_id = ? AND status IN ('running', 'paused', 'landing')
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(boardId) as StackRow | undefined) ?? null,

  items: (db: Database.Database, stackId: string) =>
    db
      .prepare(`SELECT * FROM stack_items WHERE stack_id = ? ORDER BY position`)
      .all(stackId) as StackItemRow[],

  item: (db: Database.Database, id: string) =>
    (db.prepare(`SELECT * FROM stack_items WHERE id = ?`).get(id) as
      | StackItemRow
      | undefined) ?? null,

  itemForSession: (db: Database.Database, sessionId: string) =>
    (db
      .prepare(`SELECT * FROM stack_items WHERE session_id = ? LIMIT 1`)
      .get(sessionId) as StackItemRow | undefined) ?? null,

  updateItem: (db: Database.Database, id: string, patch: ItemPatch) =>
    update(db, "stack_items", id, patch),

  update: (db: Database.Database, id: string, patch: StackPatch) =>
    update(db, "stacks", id, patch),
};

export const itemIds = (json: string): string[] => {
  try {
    const ids: unknown = JSON.parse(json);
    return Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};
