# Every reason a task waits is one `Hold`

Date: 2026-10-15

## Decision

The reasons a queued task (or a paused one due to resume) isn't starting are
one type, `Hold` in `lib/tasks/holds.ts`, and one function,
`holdsFor(candidate, context)`, returns every hold that applies, always in the
same order: `after`, `after_any`, `orch_paused`, `window`, `needs`,
`load_red`, `load_amber`, `heavy`, `spacing`, then `slot`. The first is the
reason shown. The scheduler's start decision, the queue view's note, a queued
row's stored `wait_code`, and a paused task's resume note all read that list;
nothing else composes waiting text.

- `Hold` is a union on `code` (the same `WaitCode` a row stores and the
  client reads). A hold that rests on a machine also says which one, and the
  time it lifts when that's known (spacing, the simulator gap, the red
  settle). One that can't go to a linked machine carries why it stays.
- Whether a hold clears by itself is a table by code (`clearsByItself`), not
  a stored field: a Pause is lifted by a person and a missing Mac never
  appears by waiting; every other hold lifts on its own.
- The checks that need the database or this machine are in
  `lib/tasks/hold-checks.ts` and return `Hold`s: the orchestrator's Pause and
  the usage window, `after`, and this machine's load for a start here. The
  load checks a paused task's resume, a first-task's hand-off home and the
  queue's "start now" all ask are the same call (`localHolds`).
- `lib/tasks/queue.ts` (1,400 lines) is split by job: `queue-types`,
  `queue-rows`, `queue-view`, `queue-candidates`, `queue-placement`,
  `queue-start`, `queue-tick`, with `queue.ts` keeping the request side and
  every export it had.

Behaviour is unchanged. Every waiting text is the string it was, and the
first hold is the one the old first-match rule chose.

## Why

Holds and their words were spread over `queue.ts`, `schedule.ts`,
`placement.ts`, `auto-hold.ts`, `pause.ts` and `remote-plan.ts`; the set of
holds a linked machine could lift was written twice, and the text a person
saw was assembled in three places (`withStayReason`, `resumeWaitNote`, and
inline `replace` calls that stripped "Waiting: "). A new hold meant finding
each of them.

## Alternatives considered

- **`kind` instead of `code`, and a stored `clears` flag.** Rejected: `code`
  is already the database column and the client's type, and the scheduler's
  tests build `{ code, text }` values. A rename is churn with no gain.
- **Return only the first hold.** Rejected: the list is what lets the view,
  the docs and the tests agree on order, and shows two reasons when two apply
  (paused and out of window).
- **Fold the held-task files in.** Not done: `held.ts` and `held-remote.ts`
  are about a task held by the device that sent it (who may merge or message
  it) and the calls relayed to it. That is ownership, not waiting. The
  remote calls stay as they are.

## Consequences

- A new hold is a variant, a place in `HOLD_ORDER`, and a check; the table
  test in `lib/tasks/holds.test.ts` covers each kind and the order.
- Two refusals stay outside the model on purpose: the brakes refusing a
  start (`Waiting: <reason>`, no code) and the orchestrator's "start now"
  replies. They answer an action, not a wait.
- The usage window carries no `until`; its reading doesn't expose one.
