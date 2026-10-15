# One contract for running a task on a linked machine

Date: 2026-10-15

## Decision

A task that runs on a linked machine is driven through one lifecycle contract
on that machine's own task API. It has three parts, all in
`lib/tasks/contract/`:

- **A typed client** (`client.ts`) is the only code that knows the task
  routes: start, list/view, plan, approve plan, message, chat tail and facts,
  stop, resume, done, merge, drop, hold, import/export/arrived/moved, held
  replies. Paths and timeouts are in `routes.ts`; retrying a call that may
  have landed (`postIdempotent`, `tell`) and asking the list whether a merge
  landed are in the client, once.
- **One authorization rule per route** (`authorize.ts`): `holder` (only the
  device that holds the task; unheld is 404), `open` (the holder when there is
  one, anyone otherwise) and `plan` (open, and a plan another machine placed
  here is read and approved by that machine only). Every task route a peer
  calls uses `refuse` or `taskRoute`. The checks fire only on a row that is
  held or plan-waiting, which only the machine running the task has, so a
  mirror row or a task started on this machine stays actionable from its own
  web UI, which sends no device.
- **One sync loop** (`sync.ts`, `syncMirrors`) on the queue tick: it reads each
  machine's task list once and applies it to every mirror: finished and moved
  status, a plan written (copied, announced, carried on), a plan note to tell
  the orchestrator about, an approved plan coming home. It replaces the status
  writes that happened while rendering the list, the per-mirror plan poll, and
  the plan note written while reading orchestrator facts. Rendering a mirror
  is read-only now.

The entry points that already existed stay the single function for each
operation: `signOff`, `dropTask`, `deliver`, `stopSession`, `doneSession`,
`approvePlan`, `moveTask`, `createTask`, `listTasks`. Each runs the local
implementation or calls the client; nothing has a second "remote" version.
`held-remote.ts`, `remote.ts`, `remote-views.ts`, `remote-plan.ts` and
`held-routes.ts` are gone.

## Why

Each remote feature had grown its own twin: its own paths, timeouts, cache
reads, mirror predicate and poll, and its own (sometimes missing) caller
check. `drop`, `move`, `model`, `priority` and `plan-edits` had none, so any
paired device could act on a task another machine's orchestrator held.

## Compatibility

No route was renamed and no request or response shape changed, so a machine
on the previous version and one on this version keep working through a deploy
that reaches them at different times: the new client sends what the old one
did, and the new checks only refuse a device that does not hold the task.
Machines now report the `task-contract-1` capability.

Shims kept for that window, each marked `compat: task-contract-1` in code:

- the "hold it first, then retry" heal for a task placed before machines held
  tasks (`held-calls.ts`);
- the fallback to the task list when a machine lacks the `held-chat-facts`
  capability (`lib/orchestrator/task-state.ts`).

They can be removed once every linked machine reports `task-contract-1`, one
deploy after this one reaches all of them.

## Alternatives

- **Versioned routes (`/api/v2/tasks/...`).** Rejected: no shape changed, so
  it would double the routes for nothing. A capability marks the version when
  a shape does change.
- **One generic call endpoint.** Rejected: it loses the per-route
  authorization and logging.
- **Leave the twins.** Each new remote feature would add another module, poll
  and `isMirror` branch.

## Consequences

A new remote feature adds an operation to the client and a rule to its route.
It does not add a module, a poll or a predicate. The plan columns
(`plan_waits_for_caller`, `plan_phase = 'handoff'`, `plan_handoff_message`)
and the hold columns are the contract's state and stay.

The plan note and a finished mirror are now recorded on the queue tick, not
on the read that happened to notice them, so they arrive within a tick.

Tests run the client against the real route handlers with two databases in
one process (`lib/db/machine-scope.ts`, `contract.test.ts`).
