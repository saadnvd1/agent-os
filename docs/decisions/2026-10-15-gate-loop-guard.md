# The merge gates escalate on a loop, not on a second failure

Date: 2026-10-15

## Decision

A task's PR (or a PR no task owns) goes to Saad only when it's stuck, not
when a gate fails on a second commit.

- Every new head is judged as before: CI, a fresh independent review, scope,
  the code-review and blocked and stack gates. There is no cap on ordinary
  fix rounds, and an armed task stays armed and merges by itself once a head
  passes every gate.
- The loop guard (`lib/orchestrator/loop-guard.ts`) escalates when either:
  - the same gate has failed on `LOOP_GUARD_COMMITS` (4) distinct commits in
    a row. A pass of that gate, seen while counting, starts the count again;
  - the same gate failed the same way on two consecutive commits: an
    unchanged signature, worked out without a model call. CI: the failing
    job and its failing test names, else its first error line, read from
    `gh run view --log-failed` once per head. Review: its blocking findings'
    `file:line` (a finding with no place by the start of its summary).
    Any other gate: its reason with commit ids taken out. No signature (the
    log couldn't be read) never matches.
- Saad's ask says which condition fired and lists the failures, oldest
  first.
- After it goes to him, AgentOS still reviews the commit his ask names and
  writes CI and that review into the ask ("Gates at abc1234: ...",
  `lib/orchestrator/ask-verdict.ts`), so he never approves blind. His
  approval still merges that one commit once, as before; the review informs
  it and doesn't gate it.
- The reviewer prompt names gaming a gate (tests deleted, skipped or
  weakened, assertions loosened, checks or CI steps disabled) as always
  blocking.

State: `orchestrator_gate_failures` gains `streak`, `last_signature`,
`repeated` and `escalated_why`; `orchestrator_gate_failure_commits` gains
`signature`. `count` still counts every failed commit, for the usage and
audit reports.

## Why

The two-strike rule fired three times on 2026-10-15 and helped none of them.
A second CI failure was a clash with a test that had just merged, a normal
fix round. On another PR, Saad's approval merged the fix commit with no
review of the fix at all, because a held task wasn't reviewed.

A loop is what a human should break: the same failure coming back, or a
task that can't get a gate green after several tries. A second, different
failure is just work.

## What stays the same

- A failure counts once per task, gate and head commit, from any path.
- Approval-only escalations (sensitive files, a diff too big to review) and
  a repository with no CI go to Saad as before.
- A held task never merges by itself; only his approval of its exact head
  does, once, and a new head goes back to him.
- An approval of an ask the orchestrator raised still needs a passing code
  review of that commit.

## Alternatives

- Keep two strikes but skip "obvious" clashes: needs judging which failure
  is whose, which is the model call this avoids.
- A model comparing failures: costs tokens per failure and isn't
  deterministic; a signature is enough to spot the same failure.
- No cap at all: a task stuck on a gate it can't pass would loop forever.
