# Split the sessions table into focused tables

Date: 2026-10-15

Status: the old columns were dropped the same day (see "Follow-up" below);
the mirror and the sync triggers described here are gone.

## Decision

`sessions` had 95 columns grown over 101 migrations: plans, holds, pauses,
placement, PR and CI state and task metadata all lived on one row, so every
feature edited the same table. 42 of the columns now also live in five tables,
grouped by what they are about. Each is keyed by `session_id` and holds a row
only for a session with a value in the group.

| Table               | Columns                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session_tasks`     | task_prompt, task_brief, task_status, task_since, task_ended_at, merged_at, priority, quick_of, moved_to, moved_from, model_overrides, lh_card_id, lh_board_id, lh_card_list |
| `session_prs`       | pr_url, pr_number, pr_status, merge_armed_at, merge_armed_seen, rebased_from, rebased_to, rebase_asked_head, pr_wake_since                                                   |
| `session_plans`     | plan_phase, plan_only, plan_decided, plan_reason, plan_note, plan_edits, plan_waits_for_caller, plan_handoff_message                                                         |
| `session_placement` | peer_mirror, placed_note, held_by_device, held_from, held_for, held_for_name, started_by_device                                                                              |
| `session_pauses`    | pause_state, paused_until, pause_id, pause_note                                                                                                                              |

Stays on `sessions`, because it is true of every session and not of a task:
identity, project and workspace, `host_id`, `started_by`/`started_via`, the
worktree and port columns (`base_branch` with them), `setup_*`, the nine
`chat_*` columns, the shelf times (`active_at`, `settled_at`, `snoozed_*`,
`archived_at`, `pinned`, `last_seen_at`), the model, and the old conductor
columns. PR state is its own table rather than part of the task: a plain
worktree session has a PR too.

Additive only. Migration `20261015T1800_split_sessions_tables` creates the
tables, backfills them from `sessions`, and builds the rest; nothing is dropped
or renamed and no `sessions` value changes.

- **Reads** go through the view `session_rows`: every `sessions` column under
  the same name and in the same order, each moved one taken from its table.
  A row is the flat session it was, so API and remote-task payloads built from
  rows are unchanged. Lists select the same columns as before from the view.
- **Writes** go through one module per table, `lib/db/session-parts/`
  (`setTask`, `setPr`, `setPlan`, `setPlacement`, `setPause`, and a few named
  helpers). They write the table, then mirror the same values onto the old
  `sessions` columns in one transaction. That mirror, in `write.ts`, is the one
  dual-write, and no call site does it. An optional condition on the current
  values makes a write a compare-and-set.
- **Triggers** on `sessions` carry a write straight to an old column into the
  tables, and `merged_at`/`task_ended_at` are still stamped by the existing
  `sessions` triggers, which the mirror fires. They exist because (1) a chat
  worker keeps its old code until it idles, (2) a rollback puts old code on a
  migrated database, and (3) a linked machine runs a different version for one
  deploy. Only the changed columns propagate, so an old write never undoes a
  newer one.
- `lib/db/session-parts/guard.test.ts` fails on SQL on `sessions` that names a
  moved column or selects `*`, so raw SQL on these columns lives in the module
  and the view. Seed and fixture code (`*testing.ts`, `test-fixtures`,
  `__fixtures__`, screenshot seeds) keeps writing the old columns on purpose:
  that exercises the triggers.
- The runtime `PRAGMA table_info(sessions)` that built the list columns is gone
  (the list is `SESSION_ROW_COLUMNS`, pinned to the table by a test). The one
  in `schedules-move.ts` stays: it runs inside migration 81, against a table
  older than any of this.

## Why

Every feature that touched a plan, a hold, a pause or a PR edited the same
row and the same 93-column mental model, and the raw SQL was spread over 58
files. The tables say which concern a column belongs to; the writers are in one
place per concern.

## Compatibility

The Mac and a linked box each run the migration on their own deploy and may run
different versions in between. No route or payload changes: the remote task
contract's views are built from `session_rows`, which has exactly the old shape
(`lib/db/split-sessions-migration.test.ts` compares it to `sessions` row for
row, key order included). An older build that writes the old columns is carried
into the tables by the triggers; an older build never reads the new ones.

## Follow-up: drop the old columns (done, 2026-10-15)

Saad approved the destructive step on 2026-10-15 ("do this immediately, just
do a full cutover"). Migration `20261015T1830_drop_moved_session_columns`:

1. Takes a full copy of the database first (`VACUUM INTO`
   `~/.agent-os/backups/agent-os-<UTC time>-<pid>-drop-moved-session-columns.db`,
   `lib/db/backup.ts`), checks the copy holds every session, and throws before
   any change if it can't. A database with no sessions has nothing these columns
   could lose and takes no copy (every fresh test database).
2. Back-fills every value still only on `sessions` into its table (a missing
   part row is inserted; a null part column takes the `sessions` value). A value
   already in a table wins: tables were written first.
3. Drops the sync triggers (`session_*_from_sessions_ins`/`_upd`) and the
   `sessions_merged_at`/`sessions_task_ended_at` triggers, and stamps
   `merged_at`/`task_ended_at` from triggers on `session_tasks`, on update and
   on the insert a first status write makes. The `_from_sessions_del` triggers
   stay: they copy nothing and clean up if foreign keys are ever off.
4. Drops `idx_sessions_task_status`, `idx_sessions_moved_from`,
   `idx_sessions_quick_of` and the 42 columns (`ALTER TABLE ... DROP COLUMN`;
   a table rebuild would cascade-delete every part row), then rebuilds
   `session_rows` with the same output columns in the same order, now ordered
   by `SESSION_ROW_COLUMNS` rather than the table.

The whole change runs in one immediate transaction that re-reads the columns
after taking the lock, so a second process opening the same database does
nothing. `writePart` no longer mirrors; tests, fixtures and seeds write a flat
row with `insertSessionRow`/`updateSessionRow` (`lib/db/session-parts/rows.ts`),
and `guard.test.ts` now scans them too, plus `.js`, `.mjs` and `.sh`, leaving
out only migrations and the tests that build a database as it was before them.

Compatibility after the drop: a linked machine on an older build talks to this
one over the HTTP API, whose payloads come from `session_rows` and are
unchanged. Code that still writes an old column directly (a chat worker that
has not restarted since the deploy before #368) now fails that statement; no
build since #368 does.

Next candidates, not done here (in `ideas.md`): a `session_chat` table for the
nine `chat_*` columns (chat workers must be on the new writers first), and the
conductor columns if nothing reads them.

## Alternatives considered

- **Reads through each module too.** Rejected: ~100 files filter and join on
  these columns, and each filter is the reader's own query. The view is the one
  place the columns are sourced; moving every filter into a function would
  rewrite their logic for no gain.
- **A row in every table for every session.** Rejected: most sessions have no
  plan, pause or PR, and an absent row says so.
- **Write the new tables only, no mirror.** Rejected: a rollback or an
  unrestarted chat worker would read stale values.
- **Foreign keys.** On, as everywhere (`better-sqlite3`'s default), so a
  delete cascades and an id change follows (`ON DELETE/UPDATE CASCADE`); the
  delete trigger is belt and braces.
