# AgentOS

A self-hosted, mobile-first home for your AI coding agents. Run Claude Code,
Codex, Gemini CLI and others side by side, chat with them or drop into their
terminal, hand off tasks that end in a pull request, and check on all of it
from your phone.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="screenshots/hero-light.png">
  <img alt="AgentOS: sessions grouped by workspace, a chat with plan, steps and diffs, and the git panel" src="screenshots/hero.png">
</picture>

![AgentOS on a phone: a chat and the session list](screenshots/mobile.png)

Demo video: https://github.com/user-attachments/assets/0e2e66f7-037e-4739-99ec-608d1840df0a

## Installation

### Via npm (Recommended)

If you already have Node.js 20+ installed:

```bash
# Install globally
npm install -g @saadnvd1/agent-os

# Run setup (checks/installs tmux, ripgrep, builds app)
agent-os install

# Start the server
agent-os start
```

### Via curl (Installs everything)

For fresh installs without Node.js:

```bash
curl -fsSL https://raw.githubusercontent.com/saadnvd1/agent-os/main/scripts/install.sh | bash
agent-os start
```

### Desktop App

Download native desktop apps from [Releases](https://github.com/saadnvd1/agent-os/releases):

- macOS (Apple Silicon): `.dmg`
- Linux: `.deb` or `.AppImage`

> **Note:** The desktop app is a native wrapper around the web UI. You still need to install and run AgentOS (via the installer script above) for the backend server. The desktop app just provides a convenient native window instead of using your browser.

> **Don't want to self-host?** Try [AgentOS Cloud](https://runagentos.com) - pre-configured cloud VMs for AI coding.

### Manual Install

```bash
git clone https://github.com/saadnvd1/agent-os
cd agent-os
npm install
npm run dev  # http://localhost:3011
```

### Prerequisites

- Node.js 20+
- tmux
- [ripgrep](https://github.com/BurntSushi/ripgrep) (for code search - auto-installed by installer script, or run `agent-os update`)
- At least one AI CLI: [Claude Code](https://github.com/anthropics/claude-code), [Codex](https://github.com/openai/codex), [OpenCode](https://github.com/anomalyco/opencode), [Kilo Code CLI](https://kilo.ai/docs/cli), [Gemini CLI](https://github.com/google-gemini/gemini-cli), [Aider](https://aider.chat/), or [Cursor CLI](https://cursor.com/cli)

## Supported Agents

| Agent       | Resume | Fork | Auto-Approve                     |
| ----------- | ------ | ---- | -------------------------------- |
| Claude Code | ✅     | ✅   | `--dangerously-skip-permissions` |
| Codex       | ❌     | ❌   | `--approval-mode full-auto`      |
| OpenCode    | ❌     | ❌   | Config file                      |
| Kilo Code   | ✅     | ✅   | Config file                      |
| Gemini CLI  | ❌     | ❌   | `--yolomode`                     |
| Aider       | ❌     | ❌   | `--yes`                          |
| Cursor CLI  | ❌     | ❌   | N/A                              |
| Amp         | ❌     | ❌   | `--dangerously-allow-all`        |
| Pi          | ❌     | ❌   | N/A                              |
| Oh My Pi    | ❌     | ❌   | N/A                              |

## Features

- **Mobile-first** - Full functionality from your phone, not a dumbed-down responsive view
- **Voice-to-text** - Dictate prompts to your coding sessions hands-free
- **Multi-pane layout** - Run up to 4 sessions side-by-side
- **tmux by default** - Every session lives in tmux, so closing the browser never kills your work
- **Multiple machines** - Run sessions on any machine you can reach with ssh keys, side by side with local ones
- **Session discovery** - tmux sessions you started yourself, on any machine, show up under the project whose folder they run in
- **Code search** - Fast codebase search with syntax-highlighted results (Cmd+K)
- **File picker** - Browse and attach files to sessions, with direct upload from mobile
- **Clone from GitHub** - Clone repos directly from the UI when creating projects
- **Git integration** - Status, diffs, commits, PRs from the UI
- **Git worktrees** - Isolated branches with auto-setup
- **Dev servers** - Start/stop Node.js and Docker servers
- **Session orchestration** - Conductor/worker model via MCP

## Chat

Sessions open as a chat by default: streaming replies, tool calls folded into
expandable steps, inline diffs for edits, a plan checklist, highlighted code
and mermaid diagrams, subagent cards, image attachments (pick, paste or drag
them in) and a Stop button, all readable on a phone. Chat drives the same
agent as the terminal (Claude Code through the Agent SDK, with your own Claude
login). The **Chat /
Terminal** switch in the tab bar hands the same conversation between the two:
the terminal resumes it with `claude --resume`, and switching back closes the
terminal so only one side drives it. Each chat conversation runs in its own
worker process (in tmux, like terminal sessions), so restarting or updating
AgentOS never cuts off a turn: the server reconnects to running workers when
it starts. History is kept in AgentOS.

The composer formats markdown as you type: `code`, **bold**, _italic_, lists,
`- [ ]` task lists, and ` ```ts ` fenced blocks with syntax highlighting.
What it sends is the markdown you typed, character for character. Code pasted
from an editor (or anything multi-line that reads like code) lands in a code
block, prose stays prose, and a paste of 32 KB or more becomes an attachment
sent as a fenced block. Cmd/Ctrl+Shift+V pastes as plain text, and the **T**
button (Cmd/Ctrl+/) turns live formatting off for this browser. Enter sends on
a keyboard and is a newline on a phone; Cmd/Ctrl+Enter always sends.
Shift+Enter is always a newline, and three of them at the end of a code block
leave it.

Type `/` in the composer for every slash command and skill the agent knows,
yours included, filtered as you type. Commands such as `/compact`, `/usage`
and `/context` run in chat and show their output inline; skills the agent
invokes on its own appear as a chip. `/model` (or the picker under the
composer) switches the model mid-conversation. Commands that only make sense
in a terminal, such as `/vim`, are left out.

The access picker under the composer sets what the agent may do on its own:
**Ask first** (an approval card in the chat for anything not already allowed),
**Accept edits** (edits files, asks before other commands) or **Full access**
(the default, like running with permissions skipped). Questions the agent asks
you come up as cards to answer. **Undo** on a message puts back the files the
agent edited since, rewinds the conversation to before it, and returns the
message to the composer to edit and resend. Changes made by shell commands
aren't tracked, so they stay.

While a turn runs, a line above the composer says what the agent is doing
and for how long (with Stop), and every step shows its time. Work the agent
starts in the background (shells, subagents, monitors) sits behind a
"running in background" chip: each task with its elapsed time, its live
output, and its own Stop. The session list says the same thing, so a long
wait never looks like nothing is happening.

![The slash-command menu open in a chat](screenshots/commands.png)

Chat runs on this machine; sessions on other machines use the terminal.
Drivers for other agent CLIs plug into `lib/chat/drivers`.

![A session in terminal view, with the agent asking before it runs a command](screenshots/terminal.png)

## Tasks

Hand off work and keep going. **Tasks → New task** takes a project and a
prompt. AgentOS creates a git worktree and branch, starts Claude there in tmux
with a brief to finish by pushing and opening a pull request, and tracks it:
Working, Needs input, Blocked, Ready for review, Checks failing or Agent
exited. **Sign off & merge** squash-merges the PR (refused while CI is failing
or pending), then removes the session, worktree and branches. **Drop** closes
the PR and removes everything. Agents never merge their own work.

Requires the GitHub CLI (`gh`) signed in, and a project with a GitHub remote.

![Tasks in different states: needs input, ready for review, working, merged](screenshots/tasks.png)

### Stacks

A project whose board is linked to LumifyHub can run the whole board as
**stacked** tasks: **Tasks → From the board → Run as stack** shows the plan
first, then starts it. A card starts as soon as every card it's blocked by has
a PR open (not merged), on top of the card it depends on most: its branch is
cut from that card's pushed branch, and its PR targets it, so each PR shows
only its own commits. At most three run at once without a PR (adjustable).

Merging goes bottom-up. Signing off a card whose parent hasn't merged is
refused; after a parent merges, every card stacked on it (grandchildren
included) is rebased and its PR retargeted, and its agent is told. **Land**
merges every PR in order after checking all of them are open and green, and
waits for each restacked PR's checks before merging it. A conflict stops on
that card with the exact command to fix it. How it works:
[docs/stacks.md](docs/stacks.md).

## Agent network

Sessions started by AgentOS can find and talk to each other without you,
through the `aos` command on their PATH (any agent CLI can use it; Claude is
also briefed on it):

```bash
aos peers                         # sessions, their project, what each is doing
aos send <session> "message"      # wakes the other session with the message
aos inbox                         # read messages sent to you
aos history <session>             # your conversation with a session
aos spawn <project> "prompt"      # start a new agent session in a project
aos task <project> "prompt"       # start a background task that ends in a PR
aos stack <project> [--plan]      # run the project's board as stacked tasks
aos stacks                        # every stack and where each card is
aos docs [query]                  # LumifyHub pages, when the workspace is linked
```

Messages are delivered by typing them into the recipient's terminal, labelled
as coming from another agent, and a rate limit stops two agents looping. The
**Messages** panel shows every conversation and lets you message any session.
Sessions on other machines can receive messages but not yet send them.

![Messages between agent sessions, and one from you](screenshots/messages.png)

## Workspaces

Group projects into workspaces (e.g. Work, Personal) from the **+** menu.
Each workspace is a collapsible sidebar section showing how many sessions need
you; move a project in from its menu. Deleting a workspace keeps its projects.

### Orchestrator

Each workspace has one standing orchestrator, pinned at the top of its
section: a chat that runs the work across the workspace's projects. It's made
the first time you open it, works from a scratch folder in
`~/.agent-os/orchestrators/<workspace>`, and is never swept with idle sessions.
Its brief lists the workspace's projects (path, board, default branch), what
it may do on its own, and the lines that always come back to you as asks.

- **Tools:** `sessions` (every session's status, activity, task, PR, CI and
  stack position), `read` (the end of a terminal or chat) and `cards` (the
  linked boards' cards), plus acting tools: `send`, `start_task`,
  `start_session`, `stack`, `stack_status`, `land`, `drop`, `stop`, `note`,
  `review`, `sign_off` and `ask_saad`. All are served in-process to its chat, refuse
  any target outside its workspace, and validate their arguments. The route
  they call answers only the orchestrator's worker, by a per-orchestrator
  secret. Its shell runs only `aos` commands that read.
- **Brakes:** every start is refused, with the reason, while 4 sessions run in
  the workspace, after 6 starts in an hour (`orch_max_running` and
  `orch_max_starts_per_hour` on `workspaces`), or when the account's 5-hour
  usage window would run out before it resets (read from the statusline's
  `~/.claude/.context-cost/limits.json`, as dispatch does;
  `AGENTOS_LIMITS_FILE` overrides). A missing file, or one not sampled for 15
  minutes, refuses too. Each card of a stack it starts is braked as its own
  start. A brake writes one note and pauses only new starts.
- **Review and sign-off:** `review` runs a fresh `claude -p` on a
  symlink-free detached checkout of the PR's exact head commit. It loads no
  settings or MCP servers from anywhere (so nothing the PR ships runs), gets
  an allowlisted environment, can only Read/Grep/Glob inside the checkout,
  and follows the repo's review skill as the base branch has it. The verdict
  is stored against that sha, and a diff over 80k characters goes to you
  instead. A task from a card also gets a scope check against the card.
  `sign_off` squash-merges only that commit when CI is green and settled on
  it (2 minutes with no new check), its review passed, nothing is
  `BLOCKED:` or waiting, the diff stays in scope (no secrets, not only
  lockfiles, nothing outside the repo, within the card) and its stack parent
  has merged. `land` judges each item again at its own head right before
  merging it. The second failure of a gate, a repo with no CI, or any change
  to CI config, build and hook scripts, agent config, deploy scripts or
  secrets handling goes to you as an ask, and the orchestrator stops merging
  that task.
- **Decision log:** `note` and the brakes and escalations write to
  `orchestrator_notes`, and each line shows in its chat.
- **Events:** the server sends it one short line per event (a PR opened, CI
  green or failed, a `BLOCKED:` line, a merge, a session needing input, a
  stack step, a task idle 30 minutes with no PR, a review's verdict). Events
  wait while its turn runs, duplicates fold, and at most one batched message
  goes out per 30 seconds. What it has been told is kept in
  `orchestrator_events`, so a restart resends nothing. Set
  `AGENTOS_ORCHESTRATOR=off` to stop events.
- **Asks:** what's yours to decide sits on its asks list
  (`orchestrator_asks`): what it raises with `ask_saad` (a decision, or
  something crossing a hard line: public or outbound, money, irreversible,
  credentials, a product call), and every escalated gate and brake. There's
  one open ask per subject (a task, the brakes, a title), so an escalation
  that repeats updates its ask. Each shows as a card under its row and at the
  top of its chat, with Approve, Decline and Reply. Open asks are its
  needs-you: the amber dot, one count each in "N need you", and the
  notifications. Your answer reaches it as an event (`ask "<title>":
approved`). An approval covers that one item only: a held task's approval
  lets `sign_off` merge it once, at the commit you approved (a new commit
  asks again), and a brake's lets one start through. An ask closes itself
  when its task is merged or dropped, or the brakes lift.
- **Header line and Pause:** its row reads like "Orchestrator · 3 running ·
  1 in review · 1 ask" from live data, and tapping it opens the chat, where
  the same line carries Pause/Resume. While paused it acts on nothing:
  events queue, acting tools refuse, and its stack starts and lands hold.
  It can still read, note and ask. Resume delivers what queued, folded.

## LumifyHub (optional)

AgentOS works fully without a LumifyHub account. Connecting one, from a
workspace's menu, gives its docs and boards a home you can open anywhere and
share with anyone:

- A workspace links to a LumifyHub workspace, and a project to a board in it.
  Tasks get a card on the project's board that moves as the task runs, and a
  card in To Do can be started as a task.
- **Docs** lists the linked workspace's pages and reads them; editing happens
  in LumifyHub.
- A markdown file open in the file explorer can be published as a page marked
  as coming from the repo. Publishing again updates the same page, and so does
  merging a task that changed the file. It goes one way: edits made in
  LumifyHub are overwritten.
- Agents can list, read and create those pages with `aos docs`, `aos doc <id>`
  and `aos doc new "<title>" --file <path>`. The token stays in AgentOS.

What maps to what, and the API it uses: [docs/lumifyhub.md](docs/lumifyhub.md).

## Machines

Open the sidebar menu (⋯) → **Machines** and add one with a name and an ssh
target (`user@host` or an alias from `~/.ssh/config`). Requirements: key-based
ssh from the machine running AgentOS (no password prompts), and tmux on the
remote machine. **Test connection** checks both.

New projects can then pick a machine. Their sessions run in tmux there and
attach over one reused ssh connection per machine. Folders match across
machines relative to `~`, so `~/dev/app` on your laptop and on a server are
the same project.

On other machines, files, git, worktrees, dev servers and summarize are not
available yet; the terminal, status, rename and send-keys are.

## Security

AgentOS gives whoever uses it a terminal as you, so it decides who that is:

- **This machine** (localhost) is always trusted.
- **Your tailnet** is trusted by default. Turn on "Require pairing on Tailscale
  too" in Devices if other people share it.
- **Everything else** needs a paired device. That covers Wi-Fi, `AGENTOS_BIND`,
  and any reverse proxy, including `tailscale serve`. A request that arrives
  from localhost with proxy headers (`X-Forwarded-*`, `Forwarded`, `Via`,
  `X-Real-IP`, `CF-*`, `Tailscale-*` and similar) counts as coming from the
  proxy's client, not from this machine. A proxy that sends none of these
  looks like this machine itself, so put such a proxy behind
  `AGENTOS_AUTH=off` only if it does its own login.
- A request from localhost must also be addressed to `localhost` or
  `127.0.0.1`. This stops a web page that has rebound its own domain to
  127.0.0.1 from counting as this machine.

Each paired device holds its own token. Only a hash of it is stored, and
removing the device in Devices cuts its open terminals at once. A paired
device can use AgentOS but can't add devices or change access; only this
machine and the tailnet can.

AgentOS also refuses requests addressed to any other host name (DNS rebinding),
and API calls or terminal connections made by another website's page.

| Variable                               | Effect                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `AGENTOS_NETWORK=lan`                  | Listen on Wi-Fi too. Same as the switch in Devices.                                                    |
| `AGENTOS_REQUIRE_PAIRING_ON_TAILNET=1` | Pairing on the tailnet too.                                                                            |
| `AGENTOS_BIND`                         | Listen on these addresses instead (e.g. `0.0.0.0`). Pairing still applies.                             |
| `AGENTOS_ALLOWED_HOSTS`                | Extra host names to answer to.                                                                         |
| `AGENTOS_TOKEN`                        | A device token for `aos` and the MCP server when they reach AgentOS over a network that needs pairing. |
| `AGENTOS_AUTH=off`                     | No pairing, for when your own proxy does the login. Anyone who reaches the port gets a shell.          |

## Connect (in development)

AgentOS Connect will let you reach this machine from anywhere through a
hosted relay, without opening a port. The client half is here, in
`lib/connect/`. Connect is off unless `~/.agent-os/connect/connect.json`
exists.

The relay can't read your sessions, and you can check that in this code
rather than take it on trust:

- Your machine generates the TLS key for its Connect address and never sends
  it anywhere (`lib/connect/config.ts`, `serve.ts`). Phones complete TLS with
  this process, not with the relay.
- The relay only sees the server name a connection asks for, then passes the
  encrypted bytes down your machine's tunnel (`lib/connect/frames.ts`,
  `mux.ts`).
- Everything that arrives through the tunnel goes through the same
  paired-device check as Wi-Fi, and is never treated as this machine
  (`lib/security/auth.test.ts`).

## Development

```bash
npm run screenshots  # regenerate screenshots/ from a demo instance with fake data
npm run dev          # http://localhost:3011
npm test             # vitest
npm run lint         # eslint
npm run check        # typecheck, lint, format and tests: what CI runs
scripts/redeploy     # pull, install, build; restarts via $AGENTOS_RESTART only if all of it worked
```

A pre-commit hook formats and lints staged files, then typechecks and runs the
tests. CI runs `scripts/check --build` on every pull request and push to main.

## CLI Commands

```bash
agent-os run       # Start and open browser
agent-os start     # Start in background
agent-os stop      # Stop server
agent-os status    # Show URLs
agent-os pair      # Add a phone, tablet or laptop (prints a QR code)
agent-os logs      # Tail logs
agent-os update    # Update to latest
```

## Mobile Access

**At home:** open Devices from the menu, turn on "Allow devices on this Wi-Fi",
tap "Add a device", and scan the QR code with your phone. Laptops open the link
and type the code. Each code works once, for 10 minutes.

**Anywhere:** install [Tailscale](https://tailscale.com) on this machine and
your phone and sign in to the same account. Devices then shows a Tailscale
link, which works from anywhere and is encrypted. Use Wi-Fi access only on
networks you trust, because traffic on Wi-Fi is not encrypted.

## Documentation

For configuration and advanced usage, see the [docs](https://www.runagentos.com/docs).

## Related Projects

- **[aTerm](https://github.com/saadnvd1/aTerm)** - A Tauri-based desktop terminal workspace for AI-assisted coding. While AgentOS is a mobile-first web UI, aTerm is a native desktop app with multi-pane layouts optimized for running AI coding agents (Claude Code, Aider, OpenCode) alongside shells, dev servers, and a built-in git panel. Choose AgentOS for mobile access and browser-based workflows, or aTerm for a native desktop terminal experience.
- **[LumifyHub](https://lumifyhub.io)** - A place to keep docs, boards and notes, and share them with anyone. AgentOS can link a workspace to it: tasks become cards on a board, and plans and docs live where you can read and share them.

## License

MIT License - Free and open source.

See [LICENSE](LICENSE) for full terms.
