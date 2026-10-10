# Queued tasks are first-class

Date: 2026-10-10

## Decision

A task that can't start yet waits in a queue instead of being refused. It
waits for one of two things:

- **A slot.** Each workspace can have a limit on running tasks
  (`max_running_tasks`; none by default, so nothing changes until it's set).
  A new task over the limit is queued with no worktree and no agent.
- **Another task.** `after` holds it until a named task finishes (merged,
  dropped or done), or with `after: "any"`, until the first of the tasks
  running at that moment finishes. The named task can be a queued one, so
  tasks can be chained.

Queued tasks start by themselves, in line order, when a slot frees and their
`after` is met. Pause stops automatic starts. A task the orchestrator queued
still goes through its brakes and the usage-window check at the moment it
starts, and the orchestrator gets an event when it does. A person can start
one now, move it up or down, or remove it.

## What t3code does

t3code (pingdotgg/t3code) queues **messages within a thread**, not whole
threads ([#11673](https://github.com/pingdotgg/t3code/pull/11673), issue
[#267](https://github.com/pingdotgg/t3code/issues/267)):

- A follow-up sent while the agent works is queued. It's sent at the next tool
  boundary or when the turn ends, first in first out (`startNextQueuedRun` in
  orchestration v2, [#17773](https://github.com/pingdotgg/t3code/pull/17773)).
  It holds while an approval or question is pending.
- Each queued message shows as a dashed bubble with a clock and "Queued" at
  the end of the timeline, with **Send now** (steer) and **Remove**. It has no
  reorder control and doesn't show a position.
- In v2 a run gets its ordinal when it's queued, not when it starts, in a
  table with `UNIQUE(thread_id, ordinal)`
  ([#17764](https://github.com/pingdotgg/t3code/pull/17764)).
- Upstream has **no concurrency limit** on threads. A proposed cap of 8
  concurrent turns ([#10097](https://github.com/pingdotgg/t3code/pull/10097))
  rejected the ninth turn instead of queueing it, and it was closed unmerged.

AgentOS already queues chat messages the same way (lib/chat/queued.ts). What
it lacked was the level above: whole tasks.

## What we copy

- **The place in line is fixed at queue time.** Each row gets a `position`
  when it's inserted, and the line is read in that order. A restart reads the
  same line.
- **Send now and Remove** become **Start now** and **Remove**. Start now goes
  past the limit, the `after` wait and Pause, because a person asked for it.
- **A failed start stays visible** with its error rather than vanishing. It's
  retried twice, then marked failed, the same as a stack card.
- **"Queued" is a state of the thing itself**, shown where the thing is shown:
  the same task row, labelled Queued.

## What we do differently, and why

- **We queue whole tasks behind a limit.** t3code's unit is a turn in one
  thread. Ours is a task with its own worktree and agent, which is what
  overloads the machine. So the limit counts running tasks per workspace.
  A task keeps its slot until it finishes, even with its PR open, because
  that's when its worktree, ports and database go away.
- **Over the limit we queue, not reject.** t3code's proposed cap rejected the
  extra turn. The orchestrator's running-session brake did the same, so the
  orchestrator kept "start X when a task finishes" in its own notes. A queue
  that holds the start makes that bookkeeping unnecessary.
- **`after` is ours.** t3code has no dependency between threads. Ours covers
  the orchestrator's real pattern: start this follow-up once that task lands.
- **Reordering and a position number.** They're cheap here (swap two
  positions) and they answer "when does mine start?".
- **No second scheduler.** The queue is ticked by the stack watcher's loop
  (lib/stacks/tick.ts), and slots are filled by the same `fillSlots` that
  stacks' `planTick` uses (lib/stacks/ready.ts). Stacks keep their own
  `max_parallel`. Their cards aren't counted against the workspace limit,
  since each stack already caps itself.
- **A queued task has no session row.** It's a `task_queue` row whose id is
  the session id it will start as. Nothing that reads `sessions` (status
  polling, ports, done, the orchestrator's facts) has to learn about tasks
  without a worktree. A restart between claiming a row and creating its task
  either finds that session (marked started) or doesn't (back in line), so a
  task never starts twice.
