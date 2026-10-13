---
title: Schedules and recipes
description: Start agent work on a timer, check in on a session, and save a job that comes up again as a recipe.
order: 6
---

# Schedules and recipes

## Schedules

A schedule starts agent work at set times without you opening AgentOS:
**Schedules** in the workspace menu, the sidebar's **⋯** menu, or ⌘K. Each has a
name, a time (presets for hourly, daily, weekdays and weekly, or any
five-field cron expression, in America/Chicago unless you pick another zone),
a project and a prompt, and starts one of:

- **Task** and **Session**: now recipes (Settings > Recipes) with a timer.
  Migration 81 turned each existing recurring task or session schedule into a
  recipe, with its run history; the Schedules form no longer offers them. A
  one-off that still has one of these kinds is left as it was. To undo the
  move, stop AgentOS and run
  `npx tsx scripts/revert-schedules-move.ts --db <path to agent-os.db>`.
- **Orchestrator**: the prompt, posted to the workspace's orchestrator as a
  message from "Schedule <name>", marked as a scheduled prompt so it never
  counts as an approval.
- **Message**: the prompt, sent to a session you pick the way `aos send`
  does, marked the same way. A chat whose agent has exited (idle chats stop
  after 30 minutes) is started again to take it. The run records `delivered`,
  `queued` or why it failed. **Schedule check-ins** in a session's **⋯** menu
  fills one in. The session is stored by id, so renaming it changes nothing.
  An archived session fails the run until it's back. When the session is
  deleted or a finished task, the schedule
  turns itself off on the first run that finds it gone and says so once, in
  the orchestrator's chat and on your phone; point it at another session or
  delete it. The orchestrator isn't a target (it has its own kind):
  `aos schedule add --session <the orchestrator>` makes an orchestrator
  schedule, so it follows whichever session is the workspace's orchestrator.
  A schedule an agent made with `aos schedule add` stays in that agent's
  workspace and reaches its target labelled as that agent's request, not
  yours.

The server checks once a minute and claims each run in SQLite before starting
it, so a time never runs twice. If AgentOS was off when runs were due, it
runs only the most recent one when it comes back, marked **caught up**. A run
is **skipped** while the schedule's previous task or session is still working,
and while the workspace's orchestrator is paused. A run that fails to start is
recorded with why, noted in the orchestrator's chat and sent to your phone
(see below), once per failing streak: not again until a run starts. Every run stays in the
schedule's history with a link to what it started. **Run now** runs one
immediately, even while the last run is still working (Pause still holds it).
Task and session runs go through the orchestrator's brakes, like its own
starts: a braked run is skipped with the brake's reason and tried again on the
next minute until the brake lifts or a newer run is due (Run now obeys them
too, once). A schedule whose project has moved to another workspace fails
until it's edited. Removing a schedule keeps its history.

**One-off schedules.** Pick **Once** in the form (a date and time in the
schedule's zone), or `aos schedule add --at "tomorrow 10am" ...` (an ISO time,
`in 2h`, a weekday; America/Chicago unless `--tz`). It works with every kind,
runs once and then turns itself off; the run stays in its history, marked
done, and the schedule moves to the **Done** group. Upcoming one-offs are
listed first with their run time, how far off it is and who made it (you or an
orchestrator), each with Run now, Edit and Cancel; the count shows in the
sidebar menu and the orchestrator's header. The same claim-in-SQLite rule
applies, so it never runs twice, and one AgentOS missed while off runs when it
returns, marked **caught up**. Pause holds a one-off until you resume rather
than skipping it, and the brakes apply as for any run. A past time is refused.
Run now uses up its only run; edit it to a new time to run it again. An
orchestrator makes its own with `remind_me`: at least ten minutes ahead, 20
pending at most, in its own workspace, and it arrives as a scheduled prompt,
never an approval.

Task and session schedules run at most hourly, message schedules at most
every 10 minutes and skip a run (`still working`) while their session is
still busy, mid-turn or holding a queued message. A task schedule waits
while any task it started is unfinished (working, waiting on you, in review
or failing checks), so it can't stack up pull requests. Only one server
process runs schedules (it holds a lease in the database); a dev server runs
none unless `AGENTOS_SCHEDULES=on`, and `AGENTOS_SCHEDULES=off` stops them in
production.

## Recipes

A recipe is a saved brief: a project, a kind (a **task**, which ends in a PR
and goes through the merge gates, or a **session**, which has no PR), and a
short brief that says what to run and how to judge it. The steps belong in a
script in the repo; the recipe says "run this, judge the result". Every run
is a fresh task or session, so nothing piles up in one long conversation.

Open **Settings → Recipes** (the sidebar's **⋯** menu, the workspace menu, or
⌘K → Recipes or "Run recipe: …"). **Run** takes an optional one-off note and
shows exactly what will be sent. **Save as recipe** on a session's menu or a
finished task prefills the form from what it did, with a suggested brief to
use or ignore.

- **Carried between runs.** A run ends with one line,
  `RESULT: ok|fail key=value … | one sentence`. The next run's brief gets a
  short block (at most 600 characters) with the last run's outcome and
  those values, such as a build number; after a failure it also carries the
  last good run. With no line, a cheap model summarises the run, and with
  that unavailable the state alone is recorded. **Start the next run fresh**
  drops the block.
- **One run at a time.** A run while another is going is refused, and a
  double tap starts one run.
- **Timers.** A recipe can run hourly, daily, on weekdays, weekly or on a
  cron expression, never more than once an hour; a timer that fires while a
  run is going is skipped. Only you set timers: the orchestrator can't.
- **Orchestrator.** `recipes`, `run_recipe`, `recipe_save` and `recipe_update`
  tools, and the workspace's recipes in its brief and digest. A run goes
  through the same brakes, Pause and task queue as a task it started
  itself, and a recipe is never an approval: it can't pass a gate. The
  orchestrator gets an event when a run it started finishes, and for any
  failure.
- **History.** Each recipe lists its runs: when, how triggered and by whom,
  outcome, the reported values, cost, duration, and links to the session and
  PR, with totals.
