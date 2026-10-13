# Recipes, and plans in pieces

**Decision.** A recurring job is a recipe: a saved brief whose every run is a
fresh task or session, carrying a bounded summary of the last run. Separately,
a plan splits into several PRs only for four named reasons, enforced by a
deterministic checker.

**Why.** A long-lived session for a recurring job bloats its context and
carries stale state; improvising the steps each time drifts. A model asked to
split a plan splits by size; the rules keep it to repositories, deploy order,
a person in the loop, and independent revert.

**Calls made.**

- Recipes live in Settings → Recipes (not a new dialog), beside Schedules.
- A recipe timer is a `schedules` row of kind `recipe`, so the engine, lease
  and catch-up are shared; the form never creates that kind. Moving existing
  Schedules into recipes is a separate, later migration.
- The run reports `RESULT:` as its last line; a cheap model fills in only when
  it is missing, and the database's status always wins over the line.
- One live run per recipe, enforced by a partial unique index; a manual run is
  not braked, an agent's or a timer's is.
- Pushes now carry a scrubbed one-line title and body for plan-ready and
  feature-merged, because the phone app shows them.
- Piece rows hold waiting pieces; a piece becomes a session only when released.
- The session list joins `recipe_runs.session_id` and `feature_pieces.session_id`
  for chips; there are no link columns on `sessions`.

**Not done here.** Event triggers, repeat detection, the `aos recipe` command,
the recipe chat-origin card, and the move of existing Schedules.
