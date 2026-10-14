# Queued tasks are scored, placed, and can be paused for a time

Date: 2026-10-14

## Decision

The queue from [2026-10-10-queued-tasks.md](2026-10-10-queued-tasks.md) now
decides who starts next by a score, holds starts while a machine is loaded,
places a start on a linked machine when this one can't take it, and a running
task can be paused for a set time.

- **Score** = priority points (urgent 400, blocking 300, normal 200,
  background 100) + 0.5 per minute waited (capped at 150) + 150 for a paused
  task that is due to resume. Ties go to line position. The pure scheduler is
  `lib/tasks/schedule.ts`; its constants are named there.
- **Holds**, in order: `after`, `after any`, the orchestrator's Pause, the
  usage window (only while the brakes are on, through `readUsage()`), machine
  red, machine amber (only blocking and urgent pass), a simulator task while
  one is booting or the machines' limit is reached, a 60 s gap between
  automatic starts per machine, then the workspace's slot limit. Each writes a
  short reason on the row.
- **Start gate.** Closed on red and before the first reading; opens after two
  minutes out of red. A machine that was never red opens at once.
- **After any consumes a finish.** Before, every `after: "any"` waiter was
  released by the same finish, so three tasks all started when one ended. Now
  a finish releases one waiter (`task_queue.after_any_used`, unique), and a
  waiter whose whole set has finished is let go without taking one.
- **Placement.** What a task needs (`mac`, `xcode`, `simulator`) is the task's
  setting, a brief tag, `machine.needs` in `agentos.json`, or inferred from the
  repo. When this machine can't take a start, a linked machine that is green,
  fresh (a reading older than 60 s is red), has the project and meets the
  needs gets it, through the existing start-on-a-machine path. Linked machines
  report `GET /api/load`; they are asked every 15 s while work waits. Work
  that needs a Mac never leaves it, and a running task is never moved by the
  scheduler. The kinds of task the remote start path refuses (plan-only,
  plan-first, orchestrator-started, pinned, non-Claude, per-role models) are
  kept as holds with a reason: lifting them changes what runs on the other
  machine and is not small.
- **Pause.** `running → pausing → paused → resuming → running`. The agent
  process is ended at the end of its step (or at once for "pause now", after a
  push or merge in flight), never frozen; its worktree and conversation stay.
  A paused task frees its slot. Messages that would wake it are held and
  delivered in one continue prompt. A person outranks the orchestrator, which
  outranks the scheduler, for lifting a pause. Not pausable: merging, moving,
  setting up, waiting on a person, an orchestrator, a quick change, a task on
  another machine. State survives a restart (`task_pauses`, swept every 15 s).

## Why

Three "after any" tasks started on one finish; parallel tasks collided on the
same file; three simulators booting at once took a 10-core machine to a load
of 120. The score is rules-based and explainable (no model calls), and every
wait says why.

## Alternatives considered

- Strict priority with no age term: starves background work.
- Freezing the process (SIGSTOP) for a pause: model streams time out and a
  frozen build or simulator keeps its resources.
- Moving a running task when a machine goes red: a move takes minutes and
  can lose work; only new starts are placed.

## Consequences

`after: "any"` behaves differently from before. A migration adds columns to
`task_queue`, `sessions`, `bus_messages` and `projects`, and a `task_pauses`
table. Native clients read the new `sessions` columns (`priority`,
`pause_state`, `paused_until`, `placed_note`) and the `/api/tasks/queue` fields
(`priority`, `wait`, `rank`, `of`). Deferred: file-overlap holds, scheduler
auto-pause, a graded usage term, a settings screen for needs, moving a paused
task, a task pausing itself.
