# Migrations

One file per migration. To add one, add a file here and edit nothing else.

Name the file with a UTC timestamp key, `YYYYMMDDTHHMM_snake_name.ts`
(e.g. `20261014T0130_share_links.ts`), and export the migration as its default.
The key in the file must equal the file name:

```ts
import type { Migration } from "../migration-types";

export default {
  key: "20261014T0130_share_links",
  up: (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS share_links (...)`);
  },
} satisfies Migration;
```

- Never edit a migration that has shipped; add a new one. Existing databases
  have already recorded it and will not run it again.
- `0001_<name>.ts` .. `0089_<name>.ts` are the legacy numbered migrations
  (`{ id, name, up }`). They run first, by number, and never change. Do not add
  numbered ones: two tasks picking the same number collide.
- Timestamp keys run after the legacy ones, in key order.
- Keep each `up` safe to repeat (`IF NOT EXISTS`, check `PRAGMA table_info`
  before `ADD COLUMN`).
- `lib/db/migrations.generated.ts` lists these files. It is built by
  `scripts/gen-migrations-index.mjs`, which npm runs before dev, start, build,
  typecheck, lint and test, and it is not committed. Never edit it. If an import
  of it fails, run `node scripts/gen-migrations-index.mjs`.
- A duplicate id or key, or a file whose name does not match its id, throws when
  `lib/db/migrations.ts` loads. `lib/db/migrations.test.ts` also checks order, the
  legacy bodies, and that a database migrated before the split would run nothing
  again.
- Adding a column to `sessions`? `session_rows` (the view that reads a session
  with its columns from the tables they moved to) lists the columns at the time
  it was built. Add the name to `SESSION_ROW_COLUMNS` in
  `lib/db/session-parts/columns.ts` and call `createSessionRowsView(db)` after
  the `ALTER`; `lib/db/split-sessions-migration.test.ts` fails if the view and
  the table disagree. Columns that belong to a group go in `PART_COLUMNS` and a
  new migration for that table instead.
