# Model routing with pluggable providers

Date: 2026-10-11

## Decision

Every agent AgentOS launches runs as a **role**, and each role maps to a
model reference, `provider/model`:

| Role                                | Default                               |
| ----------------------------------- | ------------------------------------- |
| plan                                | `anthropic/claude-opus-5-5`           |
| review (gate review)                | `anthropic/claude-opus-5-5`           |
| implement                           | `anthropic/claude-sonnet-5-5`         |
| orchestrator                        | `anthropic/claude-sonnet-5-5`         |
| scope (scope check)                 | `anthropic/claude-sonnet-5-5`         |
| interactive                         | `anthropic/claude-opus-5-5`           |
| helper (titles, summaries, PR text) | `anthropic/claude-haiku-4-5-20251001` |

Resolution is most-specific-wins: the task's own override (one ref for its
plan and implement roles, or a map of those to refs), its workspace's,
Settings', the default. The gate roles, review and scope, skip the task's
override: whoever starts or steers a task (the orchestrator, or text it read)
must not be able to pick the model that judges it.
Everything lives in the `settings` table (`models`,
`models.workspace.<id>`), validated with zod on write.

**Claude stays the default.** Another provider runs only where a role or a
task names it, until the comparison view shows parity.

### Plan, then implement

A chat task whose plan and implement roles resolve to different models starts
in a plan phase (`sessions.plan_phase = 'planning'`): its first message asks
for the plan in `.agentos/plan.md` (that folder has its own `.gitignore` of
`*`) and nothing else. When the chat goes idle after a recorded plan turn,
one transaction moves the phase to `implementing`, sets the session's model
to the implement role's, and queues the implementation message under a fixed
id; then the live conversation switches model, and the message is sent.

This uses what Claude Code supports rather than anything new: the Agent SDK's
`setModel` on a live conversation, and `--model` (the SDK's `model` option)
on a resume, which the Claude Code docs say takes precedence over the model a
transcript was saved with. A provider change can't happen live (the endpoint
and key are in the process environment), so the worker is stopped and the
next message starts one that resumes the same conversation on the new
provider. The same mechanism serves **resume on model** for a paused task.

Terminal tasks skip the plan step: their turn boundaries are read from the
screen, which isn't reliable enough to hand a task over on.

### Providers and keys

A provider is config: an id, a label, `api` (`anthropic` or `openai`), a base
URL, a key reference, how the key is sent (`Authorization: Bearer` or
`x-api-key`), its models, and Claude Code's opus/sonnet/haiku tiers mapped to
them (`ANTHROPIC_DEFAULT_*_MODEL`, and `CLAUDE_CODE_SUBAGENT_MODEL`), so
subagents and background calls stay on the provider. DeepSeek and Z.ai ship
as presets using their Anthropic-compatible endpoints, checked against their
docs today, disabled until configured. OpenAI-compatible providers can be
defined and tested but are refused at launch: Claude Code speaks the
Anthropic API.

The key is never in AgentOS's database. A provider stores a reference only:
a tokenvault entry (`tv get <project> [desc]`), a Keychain item, or an
environment variable name. Names are validated so they can't be read as an
option or by a shell. The key is read at launch, by `execFile` (no shell),
and goes only into the agent's environment:

- A chat agent's worker (its own process) reads it and passes it to the SDK's
  `env`; the server never holds it.
- A one-shot run (review, scope check, title, PR text, summary) gets it in
  the child's environment.
- A terminal task's tmux command line carries the reference, and the pane's
  shell expands it (`export ANTHROPIC_API_KEY="$(security ...)"`), so neither
  AgentOS nor `ps` sees the key.

The variable the provider doesn't use is set empty, so a key in AgentOS's own
environment isn't sent to a third party. Every key read is remembered in
memory only so errors on their way to a log or the UI are scrubbed of it.
`project-config` already forbids a repository's `env` from setting
`ANTHROPIC_*`, and a provider's own `env` is held to the same rule.

### Usage and the comparison

The existing ledger, `chat_turns`, gains `model`, `provider`, `role`,
`duration_ms` and `window_pct` (the plan's 5-hour window when the turn
ended). Gate reviews and scope checks are already recorded in `check_runs`,
which gains `provider`; Usage reads both as one ledger, a check run as a turn
of its role. There is no new ledger.

Cost is estimated at report time from a price table (defaults in code,
overrides in Settings): per provider/model, dollars per million input, cache
write, cache read and output tokens. For Claude that's the API's list price;
the plan's real measure is the window, so each Anthropic turn is credited
with how far the window moved since the previous reading (a reset credits
the new reading). That's rough per turn and fair in sum.

Outcomes come from the orchestrator's own records: the first settled `ci`
and `review` checks (rows are one per head and kind), gate failure counts,
heads checked after the first review (rework), and the task's final status.
A task's cohort is the provider of its own plan and implement turns; reviews
and checks count toward its cost but not its cohort, so routing only the
reviewer doesn't move a task out of the baseline. Fewer than 10 tasks in a
cohort is labelled a small sample.

## Alternatives considered

- **`apiKeyHelper`** in Claude Code's settings, so Claude Code runs the
  reference's command itself. It keeps the key out of AgentOS entirely, but
  its precedence against an `ANTHROPIC_API_KEY` in the environment and under
  `--setting-sources ""` (the review runner) would need verifying per
  version; environment variables are the documented gateway route.
- **A separate short planning session** whose output the implementer reads.
  Not needed: a resume takes a new model, so one conversation keeps the
  implementer's full context of how the plan was made.
- **Per-model rows within a turn** (Claude Code reports usage per model,
  subagents included). Kept at one row per turn under the session's model for
  now; the per-model split is in `modelUsage` if it's ever needed.
- **Storing the key encrypted in the database.** Refused: a reference keeps
  rotation and revocation where the key lives, and nothing in AgentOS can leak
  what it never had.

## Consequences

- A project's `default_model` no longer picks a task's model; roles do. It
  still seeds the draft's model picker, and a Claude session started with no
  model at all takes the interactive role's.
- Orchestrators take their role's model each time their worker starts.
- A Claude transcript resumed on another provider carries Anthropic's
  thinking blocks; a provider that rejects them fails that turn, visibly.
- Routing a role to another provider moves spend off the Claude plan; the
  comparison view is how to tell whether quality held.
