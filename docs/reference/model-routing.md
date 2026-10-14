# Model routing

Planning, gate reviews and the orchestrator run on Opus, implementation and
scope checks on Sonnet, titles and summaries on Haiku, each editable in
Settings → Models and per workspace. A task plans on one model and
implements on another in the same conversation, can be resumed on any
model, and can run on another provider (DeepSeek, GLM, any
Anthropic-compatible endpoint) whose key stays a reference.
**Usage → Compare** shows Claude-only and routed tasks side by side.

Each kind of work AgentOS launches an agent for runs on its own model, set in
**Settings → Models** (⌘K → Model settings). A model is named
`provider/model`:

| Role                                                | Default                               |
| --------------------------------------------------- | ------------------------------------- |
| Task planning (a task's plan step)                  | `anthropic/claude-opus-5-5`           |
| Gate review                                         | `anthropic/claude-opus-5-5`           |
| Task implementation                                 | `anthropic/claude-sonnet-5-5`         |
| Orchestrator                                        | `anthropic/claude-opus-5-5`           |
| Scope check                                         | `anthropic/claude-sonnet-5-5`         |
| Interactive sessions                                | `anthropic/claude-opus-5-5`           |
| Chat & summary helpers (titles, summaries, PR text) | `anthropic/claude-haiku-4-5-20251001` |

The most specific setting wins: a task's own model, then its workspace's
(**Settings → Workspaces → Models**), then Settings, then the default.
`AGENTOS_REVIEW_MODEL` (gate review and scope check) and
`AGENTOS_TITLE_MODEL` (helpers) in the server's environment still replace a
role's default where Settings names none. A
Claude session you start without a model runs on the interactive role's. One
an orchestrator starts (its `start_session`, or `aos spawn` run from an
orchestrator) is recorded as started by it (`started_by`) and runs on the
implementation role instead, so delegated work doesn't use Opus by default;
`start_session` takes a `model` (`"provider/model"`, checked like a task's:
gate roles can't be set, other providers must be enabled). One you pick a
model for keeps it.

**Plan, then implement.** A chat task whose planning and implementation
models differ starts with a plan step: its first turn runs on the planning
model and writes the plan to `.agentos/plan.md` in its worktree (ignored by
git), changing nothing else. When that turn ends, the same conversation
switches to the implementation model (a live model switch, or a resume with
`--model` when the provider changes) and is told to follow the plan. Turn it
off in Settings, or per task with `plan: false`. Terminal tasks skip it. An
orchestrator decides it for every task: `start_task` requires `plan` and a
short `plan_reason`, stored on the task and shown on its card ("Planned:
touches 6 files across gates and UI" / "No plan: one-line default change"),
and **Usage → Compare** splits cost into planned and not. When the plan step
finishes, the orchestrator gets one event with the plan file's path and a
3-5 line summary; the handoff to implementation stays automatic.

**Plan only.** A task started with `plan_only` (`start_task`'s `plan_only`,
`aos task --plan-only`, or `plan_only: true` on `POST /api/tasks`) writes its
plan on the planning model and then stops: no model switch, no implement
prompt, even when one model does every role. It sits in a **Plan ready**
state (`plan_phase` `awaiting`, stored on the task, so it survives a restart)
that isn't blocked, doesn't count as needing you, and holds no agent process
(its worker is released; the conversation resumes on approval). The
orchestrator gets one event with the plan's path, a summary and that the task
is waiting. **Approve** on the task row (plan viewable there), `POST
/api/tasks/<id>/approve-plan`, or the orchestrator's `approve_plan(task,
message?)` continues it on the implementation model, once; a message amends
the plan and is recorded on the task's brief as a scope change, so the review
judges against it. Reject with **Drop**. A chat task on this machine only; it
can't move until approved.

**Per task.** The task draft has a **Model** chip ("Routed by role", or one
model); `POST /api/tasks` and the orchestrator's `start_task` take `model`, as
`"provider/model"` for the task's own roles or a map such as
`{"implement": "zai/glm-5.3"}`, and `plan`. Its gate review and scope check
never follow a task's model, only Settings and its workspace, so work can't
pick its own reviewer. **Resume on model…** on a task's row
(or `POST /api/tasks/<id>/model`, or the orchestrator's `set_task_model`)
moves a paused task to another model: same conversation, same worktree, and
it keeps that model from then on. Each turn records the model, provider and
role it ran as.

**Providers.** `anthropic` is your Claude login and needs no key. Others are
Anthropic-compatible endpoints (OpenAI-compatible ones can be defined and
tested, but Claude Code can't run on them): a base URL, where the key lives,
the models, and Claude Code's opus/sonnet/haiku tiers mapped to them so
subagents and background calls stay on that provider. DeepSeek
(`https://api.deepseek.com/anthropic`) and Z.ai GLM
(`https://api.z.ai/api/anthropic`) ship as presets, off until given a key.
Claude stays the default: another provider runs only where a role or a task
picks it. If a role's provider is turned off or its key can't be read,
helper runs, reviews and the orchestrator fall back to the role's default
rather than fail. **Test provider** sends one tiny request and says whether it
answered. Changing models, providers or the test runs only from this machine
or over Tailscale, never from a paired device: a provider's URL and key
reference decide where a key is sent.

The key is never stored by AgentOS. A provider names where to read it: a
tokenvault entry (`tv get <project> <desc>`), a macOS Keychain item
(`security find-generic-password -s <service> -w`) or an environment
variable named `*_API_KEY` (not `ANTHROPIC_`, `CLAUDE_` or `AGENTOS_`). It's read when an agent launches and goes only into that agent's
environment (`ANTHROPIC_BASE_URL` with `ANTHROPIC_AUTH_TOKEN` or
`ANTHROPIC_API_KEY`), never its command line, the database, a prompt or a
log; a terminal task's shell reads it from the reference itself. Errors that
might echo a key are scrubbed of it.

**Usage → Daily: the usage ledger and the ratchet.** Every Claude response
an AgentOS chat makes (subagents and the orchestrator included) is written to
`usage_calls` as it arrives, with its input, cache read, 5-minute and 1-hour
cache write and output tokens, its model, its context size and the
session, task, workspace and role it belongs to. Terminal sessions, which no
worker watches, are read from Claude's transcripts, and gate reviews come
from `check_runs`; the same message id is never counted twice. Tokens are
_weighted_ by the API's price ratios (Opus input 1, 5-minute write 1.25,
1-hour write 2, cache read 0.1, output 5; Sonnet half, Haiku a quarter), an
estimate of how much of the plan's limits a call uses.

The 5-hour and weekly windows come from the `rate_limit_event`s Claude Code
sends on each response (the `anthropic-ratelimit-unified-*` headers), stored
with their time in `rate_limit_readings` with no extra calls. Every event's
`unifiedWindows` carries both windows (its top-level reading appears only
when a threshold is crossed). A value that hasn't moved only refreshes the
last row's time, once a minute, so a steady window reads as fresh. When the
weekly figure is over 6 hours old it is estimated from recorded usage and
marked `~`. With no agent running, the Usage screen shows the last value seen
and how long ago, not "Not available".

A rollup job inside the server (no model) writes one `usage_rollups` row per
day: weighted total, cost per merged PR, cost per _clean_-merged PR (the
headline: cost against quality), review cost per PR, the share of calls above
200k context, model mix, orchestrator share, the weekly %, and the quality
readings from existing data: first-try clean-merge rate (the first reviewed
head passed review and CI, no gate failures, no later head), fix rounds per
PR, gate escalations, scope changes, and escapes (a revert or fix PR touching
the same files within 3 days, from `gh`; unknown rather than zero if `gh`
fails). Spans of days are ratios of sums. The baseline is the first week of
rollups and only ever moves to a better value. One phone alert fires (and
stays quiet until it clears) when the 3-day cost per merged PR is over
baseline by 15%, or the clean-merge rate is under it by 10 points, naming the
supporting metric that moved most. The margins, the days averaged and the
minimum merges to judge are settings (`usage.alert_cost_pct`,
`usage.alert_clean_points`, `usage.avg_days`, `usage.alert_min_merges`,
`usage.baseline_days`, `usage.weekly_stale_hours`). A dev server doesn't run
it unless `AGENTOS_USAGE_ROLLUP=on`; `AGENTOS_USAGE_ROLLUP=off` turns it off
in production. `POST /api/usage/rollups` runs the nightly pass now. Task
cards show each task's weighted cost so far.

**Usage by model.** **Usage → By model** shows tokens and estimated cost per
role and per model in the plan's 5-hour window and the last 24 hours, from
the price table in Settings → Models (dollars per million input, cache
write, cache read and output tokens, editable).

**How to read the comparison.** **Usage → Compare** (or ⌘K → Model
comparison, or the sidebar menu) puts Claude-only tasks (the baseline,
including everything from before routing) beside routed ones, per provider,
over 7, 30 or 90 days, with a total column. A task counts under the provider
its own planning and implementation turns ran on; its reviews and checks add
to its cost wherever they ran. For each column: tasks, turns, tokens,
estimated dollars (list prices; for Claude, what the API would charge),
Claude window points per task (how far each turn moved the plan's 5-hour
window, an estimate), agent time, CI green on the first push, review passed
on the first try, gate failures and rework commits per task (heads checked
after the first review), and merged or dropped. Outcomes come from the
orchestrator's checks, so tasks it didn't run have cost but no outcome. A
column with fewer than 10 tasks is marked a small sample: a hint, not a
result. Parity means the routed column's outcome rows match the baseline's
while its window points per task drop. Why it works this way:
[docs/decisions/2026-10-11-model-routing.md](../decisions/2026-10-11-model-routing.md).
