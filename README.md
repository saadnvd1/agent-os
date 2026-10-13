# AgentOS

A self-hosted home for your AI coding agents. Run Claude Code, Codex,
OpenCode and others side by side, in a chat or their own terminal. Hand off
tasks that end in a pull request, let an orchestrator review and merge them,
and check on all of it from your phone.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="screenshots/hero-light.png">
  <img alt="AgentOS: sessions grouped by state, a chat with its plan, steps and diffs, and the git panel" src="screenshots/hero.png">
</picture>

## What it does

- **An orchestrator for each workspace.** A chat that starts tasks, answers blocked agents, and merges pull requests only through gates. Anything that is yours to decide waits as an ask. [More](docs/reference/orchestrator.md)
- **Tasks that end in a pull request.** Each gets its own worktree, branch and ports, runs the project's code review, and waits for your sign-off. [More](docs/guides/tasks.md)
- **Each kind of work on the right model.** Planning, review, implementation and titles each run on their own model, set in Settings → Models. [More](docs/reference/model-routing.md)
- **Nothing starts until you send.** ⌥N opens a draft with project, machine, agent and branch as chips. [More](docs/guides/sessions.md)
- **Other machines in the same list.** Link another machine that runs AgentOS and start or move work there. [More](docs/reference/machines.md)
- **Built for your phone.** The whole app works on a phone; pair it with a QR code. [More](docs/guides/phone.md)
- **Agents that talk to each other.** Sessions message each other with `aos`, and you see every conversation in Messages. [More](docs/guides/agent-network.md)
- **Chat or terminal, same conversation.** Streaming replies, steps and diffs, plan mode, slash commands, `@file`, undo. [More](docs/guides/chat.md)
- **Project config.** `agentos.json` gives each session its own ports, environment, files and a private Postgres copy. [More](docs/reference/project-config.md)
- **Schedules and recipes.** Start work on a timer, or save a job that comes up again. [More](docs/guides/schedules.md)
- **Plans in pieces and stacks.** A plan splits into several PRs only for a real reason; a board can run as stacked PRs. [More](docs/guides/tasks.md#plans-in-pieces)
- **Machine load and status.** A load gauge, each session's share of CPU and memory, and Needs you, Working, In review and Done as it changes. [More](docs/guides/sessions.md)
- **Workspaces.** Group projects, finish work with Done, and get a log of every merged task. [More](docs/reference/workspaces.md)
- **LumifyHub (optional).** Boards, cards and docs for a workspace, if you want them. [More](docs/lumifyhub.md)
- **No approvals mode.** One switch in Settings that approves every ask, lets brakes and plan-only tasks through, and starts every agent with its permission prompts off; each approval it makes is logged. Off by default. [More](docs/reference/orchestrator.md#no-approvals-mode)
- **Also:** a ⌘K palette, code search, a file picker, a git panel, dev servers, up to four panes, and dictation.

## Documentation

- [Guides](docs/guides/README.md): [install](docs/guides/install.md), [phone](docs/guides/phone.md), [sessions](docs/guides/sessions.md), [chat](docs/guides/chat.md), [tasks](docs/guides/tasks.md), [schedules](docs/guides/schedules.md) and the [agent network](docs/guides/agent-network.md).
- [Reference](docs/reference/README.md): how each part works in detail, from the orchestrator's gates to the development workflow.

## Install

You need Node.js 20+, tmux, and at least one agent CLI (the installer offers to set up what's missing).

```bash
npm install -g @saadnvd1/agent-os
agent-os install   # checks for tmux and ripgrep, installs what's missing, builds the app
agent-os start     # runs in the background on http://localhost:3011
```

Without Node.js, the install script sets up everything:

```bash
curl -fsSL https://raw.githubusercontent.com/saadnvd1/agent-os/main/scripts/install.sh | bash
agent-os start
```

Then open AgentOS, add a project from ⌘K, and press ⌥N. The [install guide](docs/guides/install.md) covers Windows (WSL2), the supported agents, first run and the `agent-os` commands. To use it from your phone, see the [phone guide](docs/guides/phone.md).

## Security

AgentOS gives whoever uses it a terminal as you, so it decides who that is. This machine (localhost) is always trusted. Your tailnet is trusted by default. Everything else, including Wi-Fi and any reverse proxy, needs a paired device. `AGENTOS_AUTH=off` removes pairing and gives anyone who reaches the port a shell, so use it only behind a proxy that does its own login. The full model, Connect and demo mode are in [docs/reference/security.md](docs/reference/security.md).

## Development

```bash
npm run dev          # http://localhost:3011
npm test             # vitest
npm run lint         # eslint
npm run check        # typecheck, lint, format and tests: what CI runs
npm run screenshots  # regenerate screenshots/ from a demo instance with fake data
```

A pre-commit hook checks formatting, secrets and banned terms on what is staged. Route handlers may not call `*Sync` functions, and git runs only through `lib/git-exec.ts`. More in [docs/reference/development.md](docs/reference/development.md).

## License

MIT. See [LICENSE](LICENSE).
