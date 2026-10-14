# Orchestrator tasks can move to a linked machine

Decided 2026-10-12.

## Why it was refused

An orchestrator's state (gate checks, failure counts, asks, wakes, scope changes, queue order) is keyed by the task's session id, and a move gives the task a new id on the other machine. The gates, events and brakes would have lost the task. The refusal was a stopgap, not a guarantee.

## Decision

- Re-key the orchestrator's state from the old id to the new one in the transaction that settles the move (`lib/tasks/move-carry.ts`), rather than resolving `moved_from` chains at every read. A schema-coverage test fails when a new table keyed by session id isn't listed as re-keyed or kept.
- The arriving machine holds the task for the device that moved it. Only that device may merge, arm, export, message, stop, done or read it; the arriving machine's own orchestrator, armed merges and bulk done skip it. Nothing merges on the box.
- Events by polling: the orchestrator's machine reads the other's task view and chat state. The other machine never calls back.
- The orchestrator asks for a move with an MCP tool, `move`, not `aos move`. Its tools are workspace-scoped, held by Pause and logged; widening `aos` for it would open `aos done` and `aos stop` past Pause. The shell deny list refuses `aos move|done|stop` for it.
- Messages to a held task go to the box's holder-only message route with an agent origin, not as the user's own words.
- The ask query now matches `task:<id>` subjects too, so an open ask blocks a move.
- A held task's `aos send` to its orchestrator (its name, an id prefix or `orchestrator`) is only stored on the holding machine (`bus_messages.relay_state = 'pending'`, migration 74). The orchestrator's machine pulls it with the link's device token (`GET /api/tasks/held-replies`, then an ack), and delivers it with `sendMessage` from the mirror, so the orchestrator gets the usual peer-origin line. The recipient is the mirror's own `started_by`, never anything the other machine names; a pulled message's key (`relay_key`) makes a repeat pull a no-op. The holding machine never reaches back.
- The orchestrator reads a held task's chat through `chat-tail` (whole lines, not the one-line 300-character cleaner) and its blocked and question state through the cheap `chat-facts` route, not the machine's whole task list, which is slow and, when it misses, read as "couldn't be read". The gate still fails closed when neither answers.
- Moving back is `moving` on the mirror while it runs, and the mirror is deleted once the other machine confirms: it was only how the task was shown here. The machine it leaves stops the agent, releases ports and removes the worktree only if nothing is uncommitted and every commit is on a remote, then archives the row.
- The arrival note names both machines, the one it left and the one it now runs on.

## Consequences

- Both machines need the `orchestrated-move` capability; the arriving one needs the task's model provider or it refuses.
- Stop and drop on a moved task are left to the holder; a revoked holder device can't be released yet (see ideas.md).

## Queue-placed tasks (2026-10-14)

A task the queue starts on a linked machine is held there exactly like a moved
one: the start carries the orchestrator's description (`orchestrated`, capability
`held-start`), the mirror gets `started_by` and `task_since`, and every relayed
call goes by the one `isHeldRemote` test (lib/tasks/held-remote.ts). A placed
task started before this was held is held on first contact (`POST
/api/tasks/:id/hold`, retried at most every 5 minutes), and the messages stored
for it meanwhile are sent then (older than a day are marked read).

## Queue-placed tasks (2026-10-14)

A task the queue starts on a linked machine is held there exactly like a moved
one: the start carries the orchestrator's description (`orchestrated`, capability
`held-start`), the mirror gets `started_by` and `task_since`, and every relayed
call goes by the one `isHeldRemote` test (lib/tasks/held-remote.ts). A placed
task started before this was held is held on first contact (`POST
/api/tasks/:id/hold`, which never starts anything; retried at most every 5
minutes), and the messages stored for it meanwhile are sent then, in order and
keyed by their stored id (older than a day are marked read).
