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

## Consequences

- Both machines need the `orchestrated-move` capability; the arriving one needs the task's model provider or it refuses.
- Stop and drop on a moved task are left to the holder; a revoked holder device can't be released yet (see ideas.md).
