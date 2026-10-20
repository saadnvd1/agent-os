# Session groups live inside a workspace, under Pinned

Date: 2026-10-20

## Decision

A **group** is a named, ordered shelf of sessions that belongs to one workspace
(a group of no workspace holds sessions of no workspace). It sits under Pinned and
above Needs you. This is option A of the session-groups plan; the alternatives
were groups that span workspaces and groups as a filter rather than a shelf.

Rules:

- One group per session (`sessions.session_group_id`), and the session's
  workspace (its project's, else its own) must equal the group's. Enforced in
  `lib/session-groups/`; moving a session to a project of another workspace, or
  moving a project between workspaces, clears the membership.
- Membership beats status. Only finished work goes to Done, and it keeps its
  membership, so Reopen and Restore return it. Auto-settle keeps the session in
  the group, muted. A live need stays in the group: amber row, amber count on the
  header.
- **Pinned wins over a group**: a pinned session is shown under Pinned and stays
  a member. Orchestrator rows are unchanged.
- Fold state (`collapsed`) and order (`sort_order`) are stored on the server and
  shared across devices.
- Delete is soft (`deleted_at`) with an Undo that restores the group and its members.
  Names are unique per workspace, case-insensitively, among live groups.
- Queued tasks remember their group (`task_queue.session_group_id`); a fork,
  summary and conductor worker inherit it.
- The orchestrator can file sessions into existing groups (`group` on its start
  tools, `set_group`) but cannot create them. `aos read`, `send` and `done` scoping
  is unchanged; `aos group` is scoped to the caller's workspace.
- The shelf logic is in the client-safe `lib/sidebar/shelves.ts`, so the native
  app picks it up through sync-shared.

## Why

People already keep a handful of sessions that belong to one piece of work
(a launch, a research thread). Status shelves split them up as they change state.
Keeping the group inside the workspace keeps every other workspace rule (scoping,
orchestrator, counts) intact.

## Consequences

- Additive migration only: the new `session_groups` table, the two
  `session_group_id` columns. The old `groups` table and `sessions.group_path`
  stay, unused; the old `/api/groups` routes and hooks are gone.
- `PATCH /api/sessions/:id` now honours `projectId` (it was ignored before), so
  Move to project works and can clear a foreign group.
- Native follows in a separate task once this merges.
