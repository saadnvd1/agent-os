# Experiments

**Decision.** A feature still being tried is an entry in a code registry
(`lib/experiments/registry.ts`), off until someone turns it on in Settings →
Experiments. One helper, `experimentOn(id)`, is the check on the server;
`useExperiment(id)` is the same on the client. Every model call an experiment
makes goes through `experimentRun`, which returns without starting anything
when the experiment is off.

**Why.** Trying ideas should cost nothing when they are off, and what they
cost when on should be measured, so each can be judged on value against
spend.

**Calls made.**

- The on/off state is a `settings` row, `experiments.<id>`; no row means off.
  `AGENTOS_EXPERIMENTS=off` pins every experiment off.
- Anyone using the app can switch one; no passkey or approver check.
- One table, `experiment_usage`, holds model calls (tokens, cost, duration,
  trigger) and non-model events (scripts run, suggestions shown, accepted,
  dismissed). Model calls are mirrored into `usage_calls` as helper calls,
  so the Usage page counts them too.
- Settings shows today, 7 and 30 day totals and an accept rate for
  experiments that suggest things, with a detail view per experiment.
- `sessionEnded` is the one hook where sessions finish (done, merged, a
  recipe run settling). An experiment adds itself to `END_HOOKS`; one that
  is off is never called, and each session is handed on once.

**Adding an experiment.** A registry entry, `experimentOn(id)` where it does
its work, `experimentRun` for model calls, `countEvent` for the rest, and
optionally an `END_HOOKS` entry.
