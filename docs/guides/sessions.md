---
title: Sessions and the sidebar
description: Start a session or a task from a draft, find your way around the sidebar, and see what each session is doing and how loaded the machine is.
order: 3
---

# Sessions and the sidebar

⌥N opens a draft in the project you're in. Project, machine, agent, worktree
and base branch are chips on it, model and access sit under the composer, and
**Open a PR when done** makes it a task. Unsent drafts wait in the sidebar.

![A new task draft with its project, machine, branch and PR chips](https://raw.githubusercontent.com/saadnvd1/agent-os/main/screenshots/draft.png)

## New sessions

⌥N (the **+** on a phone) opens a draft: a composer in the current project, or
the one you used last. Nothing exists until you send. Then the session is
made, and with a worktree its setup runs in the chat, stage by stage: fetch,
worktree, env files, dependencies, the project's setup script, with a log
tail. The first message waits in the queue until setup is done, so the agent
never starts on half-installed dependencies, and a restart can't lose it. The
worktree starts on a temporary branch, renamed from the first message once
it has a title (it keeps the temporary name if there's nothing to name it
from).

⌥N reuses the project's empty draft; a draft you've typed in stays in the
sidebar's **Drafts** until you send or discard it. A new draft takes the
agent, model and access you were using; a project's own agent and model win.
Chats with no project run in `~/.agent-os/scratch`.

A task or session started from a prompt gets a short name: the brief's first
heading at once (when the prompt points at a readable `.md` brief), then a
2-6 word title from a quick Haiku call a few seconds later. A chat opened as
"Session 4" is named after its first message. Anything named by hand, a card's
title, a schedule's name or `--name` is kept as given.

The agent starts once its worktree has its dependencies. On macOS the main
checkout's `node_modules` (and workspace ones like `apps/web/node_modules`)
are cloned with `cp -Rc` when the lockfile matches, and a spare clone waits in
`~/.agent-os/spare` so the next task takes it by rename, in milliseconds.
On Linux the same happens with a reflink copy where the filesystem has them,
else hardlinks from a store AgentOS keeps under `~/.agent-os/deps-store` (one
real copy per lockfile; the files tools rewrite in place are copied, and the main
checkout is never linked to). Build caches (`.next/cache`, `*.tsbuildinfo`) are copied in too when the main
checkout's are fresh and not huge, so the first typecheck or build is warm. A
main checkout whose `node_modules` doesn't match its lockfile (pulled, never
reinstalled) is not cloned from at all.
Otherwise the lockfile's frozen install runs (`npm ci`,
`pnpm/yarn/bun --frozen-lockfile`), and only that: a lockfile out of sync
with `package.json` fails setup and the agent is told. It always installs with
devDependencies even though the server runs with `NODE_ENV=production`. A
project's `agentos.json` can name exactly what to copy and clone, and its
`setup` commands (without a `clone`) replace the install; see
[Project config](https://github.com/saadnvd1/agent-os/blob/main/docs/reference/project-config.md).
Starting a task returns at once and shows **Setting up** until the agent
launches; a restart in the middle resumes it. A failed setup shows on the task
and is in the agent's first prompt (redacted, as data).

Tasks don't review their own PRs. The orchestrator's independent review of
the PR's exact head commit is the one review: `sign_off` and a stack's
**Land** refuse a PR without a passing one, and a PR body with AI
attribution. A head AgentOS rebased itself is covered by the review of the
head it rebased while the PR's own patch is unchanged. A task may still run
`/do-code-review` (the project's `.claude/skills/do-code-review`, or Claude
Code's `/code-review`) on a risky change before its PR; it's no longer
required. The review agents are in [.claude/agents](https://github.com/saadnvd1/agent-os/tree/main/.claude/agents) and the
skill in [.claude/skills](https://github.com/saadnvd1/agent-os/blob/main/.claude/skills/README.md).

Requires the GitHub CLI (`gh`) signed in, and a project with a GitHub remote.

![Tasks in different states: needs input, working, merged](https://raw.githubusercontent.com/saadnvd1/agent-os/main/screenshots/tasks.png)

Tracking PRs stays inside GitHub's GraphQL quota (5,000 points an hour).
Only running tasks are asked about: a finished task's PR comes from the
database. One `gh pr list --state open` per repository a minute covers every
running task with an open PR, and a branch without one is asked about on its
own at most every 5 minutes. A merge or sign-off always asks fresh. When gh
reports a rate limit, every gh call backs off until the limit resets, and gh
failures are logged as `[gh] ...`, at most once a minute for each kind.

## The sidebar

One flat list of every session in the current workspace, each row naming its
project underneath. The workspace's orchestrator comes first, as a compact row
with its state and how many of its asks wait on you; it starts pinned there,
and unpinning it from its ⋯ menu (remembered per workspace) drops it among the
other sessions. Sessions sit on shelves: **Pinned** (pin from a row's ⋯
menu), your **groups** (below), **Needs you** (an approval, a question, a terminal waiting for input, a
message typed and never sent, a failed task, or the orchestrator's open asks,
each with a badge), **Working** (running, or a task idle between turns),
**In review** (a task with an open pull request, or a plan waiting for
approval), **Ongoing**, **Snoozed** and **Done**. A plain session that goes
quiet isn't finished: it sits in **Ongoing**, newest activity first, with the
time it last did something ("2d"). **Snoozed** (folded) holds sessions you
set aside: a row's ⋯ menu has **Snooze** with _Tomorrow_ (9 AM your time the
next day) and _Next week_ (9 AM next Monday), and **Unsnooze**. A snoozed
session shows when it wakes, and wakes at that time, or early when it needs
you, fails, or finishes a run; a session woken by its timer carries the purple
dot. **Done** is finished work: merged or dropped tasks, sessions you
finished with a task's **Done** or a plain session's **Mark done**, and
sessions with no activity for 3 days. Done doesn't archive: the session stays
there until it does something again (a message, a run, a need), and **Reopen**
brings it back by hand. **Archived** is a separate place for what you put
away on purpose: a row's ⋯ menu **Archive** (tasks and plain sessions alike;
`aos archive` and the orchestrator's `archive` do the same), what **Clean up
idle sessions** swept, and what sat in Done for 30 days with no activity.
Open it from the sidebar's ⋯ menu → **Archived**, the workspace switcher or ⌘K; **Unarchive**
brings one back. The 30-day sweep skips pinned sessions, orchestrators, and anything that
needs you, is running or has an open pull request. A pinned session, one that is
running or has background work, one that needs you, and a task with an open
pull request never settle by themselves. Done is folded to one row, "3 done
today · 12 earlier", until you tap it (open or folded is remembered per
device, and the same for Snoozed); open, it lists newest first, ten at a
time. The orchestrator's row carries small chips for the work it
started: running, in review, blocked and queued, each left out at zero. Tap
them to show only that orchestrator's work on the same shelves; the "Showing
… work ×" chip at the top clears it (it resets on reload). A session an
orchestrator started has a small orchestrator icon on its row. A purple dot marks a session that
finished or changed since you last opened it. Search matches
titles and project names, and the project filter narrows the list to one
project and holds that project's own actions: new session, terminal, dev
server, settings, board, workspace.

Every session has its own address, `/?session=<id>`: open it in a new tab,
on a phone or from a bookmark and that session opens; **Copy link** in a row's
⋯ menu or the pane's menu copies it. The address bar follows the focused
pane's session, each switch is a history entry so back and forward move
between sessions, and an address for an archived or unknown session says so
and opens the usual home. A device that isn't paired is sent through pairing
and comes back to the same session; the address grants nothing by itself.

**Settings** (the sidebar's ⋯ menu, or ⌘K → Settings) holds every setting in
one place: **Merging** (the approval switch, merge method and branch
clean-up, with the projects that override them), **Workspaces** (each one's
running task limit), **Devices & access** (pairing, passkeys, network),
**Notifications** (this browser's sound and alerts, and your phone) and
**Schedules**. Each section has its own address, `/?settings=<section>`
(`merging`, `workspaces`, `devices`, `notifications`, `schedules`), beside
`?session=`; on a phone the sections are a list, then the one you open.

Rows move the moment a session changes state: the server pushes every change
over `/ws/status` (behind the same device gate as the terminal). The same
stream says when anything else on screen changed: database triggers mark the
tables written (sessions, stacks, schedules, asks, bus messages and more,
whoever wrote them), and the git panel's folders are polled once on the
server for every viewer. The browser refetches only what moved, so an idle tab
makes about one request a minute instead of forty. Messages are numbered: a
reconnecting phone picks up what it missed, or takes a fresh snapshot when
it's been away too long. While the socket is down, the old polling carries on.
API JSON is gzipped and the sockets use permessage-deflate.

**AgentOS reads OSC 7501**, the [Program Status
Protocol](https://www.superlogical.com/rex/docs/build/program-status): a
program in a terminal session can say it's `working`, `blocked` (on a
permission, a question or a sign-in), `done`, or failed, and that wins over
reading the screen. Blocked lands on Needs you with Approve, Answer or Sign in
and the program's message (plain text, capped); done gets the unread dot.

```sh
printf '\e]7501;state=blocked:kind=permission:app=me:msg=%s\e\\' "$(printf 'Apply 3 changes?' | base64)"
```

tmux drops sequences it doesn't know, so AgentOS watches each local terminal
session through tmux control mode: one long-lived, read-only `tmux -C`
client per session (tmux 3.2 or newer) pushes the pane's raw output, which
carries the reports, and keeps a copy of its screen for reading status, so
nothing polls `capture-pane` or taps panes with `pipe-pane`. A screen is kept
only while its pane prints, and it's checked against tmux again whenever
output settles. A session's terminal views share one `tmux attach` (it runs at
the smallest view's size), and a view that can't keep up is held back and sent
the current screen once it catches up. On older tmux, or with
`AGENTOS_TMUX_CONTROL=off`, AgentOS falls back to copying each session's
output to itself (`tmux pipe-pane`, through a unix socket only you can reach;
needs `nc`) and reading screens with `capture-pane`. Claude Code sessions AgentOS starts on this
machine report through hooks it installs (`~/.agent-os/claude-status-hooks.json`,
passed with `--settings`). Not covered yet: sessions on other machines (their
output never passes through this one), Codex and the other agents (Codex only
notifies when a turn ends, with nothing for "working" or "blocked"; they keep
reading the screen), and the terminfo
`Pst` capability (the pane's terminal is tmux's).

The screen covers what no report says. A selection menu at the bottom of a
terminal (Claude Code's "Enter to select · ↑/↓ to navigate", a Codex "› 1."
list) lands on Needs you with **Answer** and its question, for sessions
without the hooks. Text typed into a Claude Code or Codex input box and left
unchanged for a minute while the agent sits idle lands there with **Unsent**
and the text, so a message that never got sent doesn't wait for hours. The
dim suggested prompt in the same box doesn't count. Claude Code fires no hook
when a question is dismissed with Esc, so a question report clears once its
input box is back on screen.

## Machine load

The dot in the sidebar header is the machine's load: green, amber (load
over 1.5 per core, or memory pressure warning) or red (over 3 per core, or
critical pressure), with some slack before it drops back. Tap it for the
numbers and the sessions using the most CPU; a busy session's row shows its
own share ("3.1 cores · 4.2 GB"), summed over its terminal's process tree
from one `ps` every 30 seconds.

Nothing is ever stopped, paused or queued. Instead, before an agent starts a
whole test suite, type check, build, repo-wide lint, `xcodebuild` or
`pytest`, the Claude hook AgentOS installs tells it what heavy commands are
already running and how loaded the machine is, so it can narrow the run or
wait. Targeted runs (`vitest run lib/x.test.ts`) are left alone. `aos heavy
-- <cmd>` does the same for anything else. When the load stays red for two
minutes, one message goes to your phone and to each workspace orchestrator,
naming the top sessions and their heavy commands; the next one waits until
it has been green for ten minutes. `AGENTOS_LOAD=off` turns it all off.

## Artifacts

The box icon in a session's toolbar opens everything the session made, in
one list: its plan and PR, the pages it rendered, the files it wrote or
edited (with an edit count), the images it took or you attached, the output
of its background jobs, and its recipe run and log. Pick one to preview it
(markdown, HTML, images and text) beside the list, or full screen on a
phone.

It is read from what AgentOS already records, the chat's tool calls, the
plan, the PR and `git status` in the worktree, so nothing is scanned and no
model is asked. Secret files (`.env`, keys, `~/.ssh`) never show, and a file
opens only inside the folders AgentOS already serves. When a worktree is
removed after a merge or a drop, the uncommitted files the session made are
copied to `~/.agent-os/kept/<session>/` first (2 MB a file, 20 MB a
session); committed ones show as in the PR. A session on a linked machine
lists its artifacts from that machine.

## And the rest

- **Status from the screen and the agent.** Every session moves between
  Needs you, Working, In review and Done as it changes, including programs that report
  their own state (OSC 7501).
- **Also:** a ⌘K palette for every session and action, code search, a file
  picker with uploads from a phone, a git panel (diffs, commits, PRs), dev
  servers (Node and Docker), up to four panes side by side, dictation in the
  terminal toolbar, and tmux sessions you started yourself listed under their
  project.

![The slash-command menu open in a chat](https://raw.githubusercontent.com/saadnvd1/agent-os/main/screenshots/commands.png)

![A session in terminal view, with the agent asking before it runs a command](https://raw.githubusercontent.com/saadnvd1/agent-os/main/screenshots/terminal.png)

### Groups

A group is a named shelf you file sessions into, inside one workspace, under
Pinned and above the status shelves. Make one from the workspace switcher
(**New group**) or from a row's ⋯ menu (**Move to group → New group…**); the same
menu moves a session in or out, and **Select** has **Move to group** for many at
once. A group's header shows its name, count and, in amber, how many of its
sessions need you; fold it with the header or its ⋯ menu (Rename, Move up, Move
down, Fold, Delete group). Fold state and order are stored on the server, so
every device sees the same.

- A session is in at most one group, and only one of its own workspace. Moving
  it to a project of another workspace removes it from its group.
- Membership wins over status: a grouped session that needs you stays in its
  group (amber row, amber count). Finished work (merged, dropped, marked done)
  goes to Done and keeps its group, shown as `Project · Group`; Reopen or Restore
  returns it. A session that merely went quiet stays in the group, muted.
- Pinned wins over a group: a pinned session shows under Pinned, still in its group.
- Deleting a group is soft: its sessions go back to the shelves and the toast's
  Undo (10 s) brings it all back.
- From the CLI: `aos group` (new, add, rm, rename), `--group <name>` on
  `aos spawn` and `aos task`. The orchestrator can file sessions into existing
  groups (`group` on its start tools, `set_group`) but never creates one.
