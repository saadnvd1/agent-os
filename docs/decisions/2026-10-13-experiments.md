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

## Learning cards (`learning-cards`)

When a session is done, merged, or its recipe run settles, scripts read it
(zero tokens) and may leave one card with up to two rows. Nothing is applied
without a tap.

- **Save as recipe?** Signals: outside a repo or an external CLI (`asc`,
  `eas`, `gh api`...) plus a report of facts (a `RESULT:` line, build numbers,
  versions, ids), or a brief whose words overlap an earlier one in the
  workspace (Jaccard ≥ 0.6, last 60 days). Only on a hit, one helper call
  with the brief and final report (never the transcript) says whether it is
  repeatable and drafts the brief. Save uses the same store call as
  `recipe_save`; Edit opens the recipe form with the drafted brief.
- **Keep this for next time?** Scripts extract at most four correction pairs
  (a failed call then the same job done differently, a blocked review then a
  pass, a person's correction then a change, a failed recipe run then a
  success). One helper call returns whether it is reusable, a one-line
  lesson and where it belongs: the recipe's brief, the repo's CLAUDE.md
  (a quick change and PR through the gates, or a small task without an
  orchestrator), a task to build a check, or a workspace rule.
- No global lessons store and nothing is injected into briefs. A lesson goes
  in the narrowest place that is already loaded when it matters. An accepted
  `learning_cards` row (date, destination, source session, where it went) is
  the record for pruning.
- The hook is registered lazily and checks the database for a prior run, so a
  restart does not repeat work. A recipe run's session usually ends before the
  run settles, so `recipe-settled` is handed on separately and the analysis
  waits for it.
- Shown, accepted and dismissed are counted in `experiment_usage`; every
  model call goes through `experimentRun`.
