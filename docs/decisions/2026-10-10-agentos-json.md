# `agentos.json`: a project describes how its sessions run

Date: 2026-10-10. Status: accepted; part 1 implemented.

## Decision

A project describes how an AgentOS session's worktree is prepared and how the
app is run and checked in one file, `agentos.json`, at the repository root.
It carries every field of dispatch's `.dispatch.json`, with the same meanings,
plus AgentOS's own `setup`. A project without one keeps working: the loader
falls back to `.dispatch.json`, then to the legacy `.agent-os/worktrees.json`
and `.agent-os.json`, so nobody has to edit a repository for this to ship.

The schema lives in code (`lib/project-config/schema.ts`, zod) and is
published as JSON Schema at `lib/project-config/agentos.schema.json`, which a
test keeps identical to the code. Point an editor at it with
`"$schema": "https://raw.githubusercontent.com/saadnvd1/agent-os/main/lib/project-config/agentos.schema.json"`.

## Why

The worktree was prepared by guesswork and the agent told nothing. AgentOS
copied every root `.env*`, cloned or installed `node_modules`, gave the
session one `PORT` that only setup commands ever saw, and then briefed the
agent with nothing about running or checking the app. Two agents on one
project would start two dev servers on the same port; each one invented its
own way of waiting for the server, and its own login. Dispatch solved all of
that with a per-project file, so the same file shape is adopted rather than a
new one, and a project already set up for dispatch works unchanged.

## Precedence (one loader, `loadProjectConfig`)

1. `agentos.json`: validated strictly, unknown keys are errors (a typo is
   the commonest mistake, and silently ignoring `"cloen"` is worse than
   refusing it).
2. `.dispatch.json`: the same schema, unknown keys ignored (dispatch has
   keys of its own AgentOS doesn't read). Its top-level `workspace` is read
   as `cards.workspace`.
3. `.agent-os/worktrees.json`, then `.agent-os.json`: `{setup, devServer:
   {command, portEnvVar}}`, mapped to `setup`, `dev` and
   `ports: {<portEnvVar or PORT>: 3100}`.

The first file that exists wins; files are never merged. A file that fails
to parse or validate is NOT skipped for the next one: the error names the
file and every bad field (`agentos.json: ports.WEB: expected number`), the
worktree setup reports it as a failed step (which the agent's first prompt
carries), and the session runs with no project config. Falling through to
an older file would run the old setup with nobody noticing the new file was
wrong.

The config is always read from the project's main checkout, never from the
session's worktree: an agent that edits `agentos.json` on its branch cannot
change its own environment or brief, and the edit is flagged as agent config
by the orchestrator's diff gate until a human merges it.

## Schema

Every field is optional. "Part" is the task that implements it; part 1 is
this change.

| Field | Type | Meaning | Part |
|---|---|---|---|
| `$schema` | string | Editor hint, ignored. | 1 |
| `ports` | `{NAME: base}` | Every named port, offset by the session's slot (`base + slot`). Exported to setup, the agent and its terminals. Without it a session still gets `PORT` (base 3100). | 1 |
| `env` | `{NAME: string}` | Exported to every session (setup, agent, terminals). Applied first, so a port or an AgentOS variable named here is overridden. Invalid names are refused, and so are names a shell, a runtime, git, the agent CLI or AgentOS reads (`PATH`, `HOME`, `NODE_OPTIONS`, `BASH_ENV`, `DYLD_*`, `GIT_*`, `ANTHROPIC_*`, `AGENTOS_*`…; `RESERVED_ENV` in schema.ts), because `env` reaches the agent and its terminals, not only setup. Never put secrets here: the file is committed. | 1 |
| `setup` | string[] | Commands run in the new worktree after `copy` and `clone`, with the ports, `env`, `ROOT_WORKTREE_PATH` and `WORKTREE_PATH` exported. AgentOS's own key (legacy `.agent-os.json`). | 1 |
| `copy` | string[] | Paths copied from the main checkout into the worktree (files or folders, relative, inside the project). Default: every root `.env*` except `*.example`. | 1 |
| `clone` | string[] | Folders APFS-cloned from the main checkout (`node_modules` entries through the lockfile check and the spare clone; anything else cloned as is). Default: every `node_modules` found, as before. On Linux `node_modules` is installed instead. | 1 |
| `dev` | string | The dev server command, for the brief. Legacy `devServer.command`. | 1 |
| `ready` | `{check}` or `{url, port?, contains?}` | How to tell the dev server is up: a command that exits 0, or a URL (a path is put on the session's `port`, else the first port). The brief turns it into one backgrounded wait. | 1 |
| `test` | string | The test command, for the brief. | 1 |
| `notes` | string or string[] | Project rules for the agent, in the brief. `$PORT_NAME` is replaced with the session's port. | 1 |
| `browse` | `{login?, map?, port?}` | The dev login as a path (rendered as a URL on the session's own port) and the file mapping pages to URLs. The brief part is 1; the per-session Chrome profile is 3. | 1, 3 |
| `database` | `{from, env?, port?, host?}` | A private Postgres database per session, cloned from `from`, its name exported as `env` (default `DATABASE_NAME`), plus `DATABASE_PORT`/`PGPORT` and `DATABASE_HOST`/`PGHOST`. | 2 |
| `mcp` | string[] | User-scope MCP servers (by name) copied into the session's own MCP config. | 3 |
| `model` | string | The project's default model for sessions. | 5 |
| `alias` | `[a-z0-9-]+` | Short name for the project in the CLI. | 5 |
| `cards` | `{workspace?, default?, boards?}` | Where the project's cards live in LumifyHub. Renamed from dispatch's top-level `workspace` (an AgentOS workspace is a different thing). | 5 |
| `auto` | `{min_free_gb?, context?}` | The orchestrator's floor (free disk) and ranking context for picking work unattended. | 5 |
| `apps` | `{alias: {path, name?, test?, notes?}}` | A monorepo's apps: each an alias that starts the agent in `path`, with its own `test` and `notes`. | 5 |
| `recipes` | `{key: {prompt, title?, …}}` | Named, repeatable task prompts. | 5 |
| `repos` | string[] | Other repositories a session gets worktrees of, alongside this one. | 5 |
| `review_skill` | string | The code review skill tasks run before their PR (default: the project's `do-code-review`, else `/code-review`). | 5 |
| `notion` | `{vault: {project, token}}` | Which secret-store entry holds the Notion token (a name, never the token). | 5 |
| `formerly` | string[] | Paths the project used to live at, so its history follows it. | 5 |

Git hooks (part 4) need no field: like dispatch, AgentOS will point the
session's worktree at a per-session hooks folder that runs the project's own
hooks, so they don't need declaring. If a project ever needs to opt out, that
is a new `hooks` field then.

Naming: dispatch's names are kept, snake_case included, so a `.dispatch.json`
can be renamed to `agentos.json` with no edits (except `workspace`, above).

## Ports: slots

A session that gets a worktree (a task, or a session with a worktree) takes a
**slot**, the lowest free integer from 1. Each named port is `base + slot`, so
one project's sessions never collide with each other by construction. The
slot and the resolved ports are stored on the session row (`port_slot`,
`ports`), so a resume gets the same ports; `dev_server_port` keeps the first
one for older readers.

- A unique index on `port_slot` makes two parallel starts unable to take one
  slot, across processes.
- Before claiming, every port of the candidate slot is checked against every
  other session's stored ports (two projects with different bases can meet)
  and against what is listening on the machine (`lsof`), then claimed in one
  transaction.
- A slot is freed when the session is done or deleted (both release it
  directly). An archived or merged session's slot is reclaimed lazily before
  the next allocation, but only once its tmux session is gone, so two live
  agents never hold one port.

## Agent environment

`agentEnv(sessionId)` is what the agent's tmux session, its chat process and
its terminals all start with: the project `env`, then the session's ports,
then `AGENTOS_SESSION_ID`, `AGENTOS_URL` and `PATH`. The order means a
project can't override a port or AgentOS's own variables.

## Brief

When the project has any config, the agent's system brief gets a short
"Running this project" section: its ports, the dev command, the ready check
and the one backgrounded `until …; do sleep 1; done` to wait for it, the test
command, the login URL on its own port and the browsing map, then the notes.
Nothing is rendered for a field the project didn't declare: a confident
falsehood about how to run the project is worse than silence. `env` values
are never rendered.

## Consequences

- `.dispatch.json` projects get their ports, env, copy, clone and brief in
  AgentOS with no edits.
- A broken `agentos.json` stops the setup steps that depend on it (with a
  clear error in the setup log and the agent's first prompt) instead of
  silently running something else.
- `agentos.json` edits are flagged as agent config by the merge gates, like
  `.dispatch.json` and `.agent-os.json`.
