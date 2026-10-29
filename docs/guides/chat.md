---
title: Chat
description: Talk to your agents in a streaming chat with steps, diffs, plans and attachments, or hand the conversation to the agent's own terminal.
order: 4
---

# Chat

Sessions open as a chat by default: streaming replies, tool calls folded into
expandable steps, inline diffs for edits, a plan checklist, highlighted code
and mermaid diagrams, subagent cards, image and file attachments (pick,
paste or drag them in) and a Stop button, all readable on a phone. Chat drives the same
agent as the terminal, with your own logins: Claude Code through the Agent
SDK, Codex through `codex app-server`, OpenCode through its own `opencode
serve` (loopback only, behind a per-conversation password) and Pi through its
RPC mode (models you host yourself: see [Local models](local-models.md)). Pi never asks before a tool, so AgentOS loads a small Pi extension
that asks the chat as the access setting says. GitHub Copilot runs through
`copilot --acp` (the Agent Client Protocol): its permission prompts become
approval cards under the same access setting, and a conversation resumes with
`session/load` after a restart. It signs in with `copilot login` or a
`COPILOT_GITHUB_TOKEN`, `GH_TOKEN` or `GITHUB_TOKEN`; it has no plan mode,
undo or in-chat model list yet, so it runs on its own default model unless one
is named. The **Chat /
Terminal** switch in the tab bar hands the same conversation between the two:
the terminal resumes it (`claude --resume`, `codex resume`, `opencode
--session`, `pi --session`, `copilot --resume`), and switching back closes the
terminal so only one side drives it. Each chat conversation runs in its own
worker process (in tmux, like terminal sessions), so restarting or updating
AgentOS never cuts off a turn: the server reconnects to running workers when
it starts. A worker from an older build finishes its turn, and any
background work (subagents, shells), then hands over at the next turn
boundary: messages that arrive meanwhile wait in the queue, and a current
worker resumes the same conversation with this build's tools and sends them.
An orchestrator fed events mid-turn picks up new tools this way with nobody
restarting it. A turn whose worker did go away mid-step is resumed
once, with a note telling the agent to check what it was doing, and a task's
orchestrator hears about it. An orchestrator's AgentOS tools are calls to the
server, so a call made while it restarts waits (up to two minutes) for it to
return; one the restart cut off after it was sent says so rather than repeat
itself. History is kept in AgentOS.

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
yours included, filtered as you type. A skill or command you add or edit
(in `~/.claude/skills`, `~/.claude/commands` or the project's own) shows up
on its own; the menu's refresh button reloads the list now. Commands such as `/compact`, `/usage`
and `/context` run in chat and show their output inline; skills the agent
invokes on its own appear as a chip. `/model` (or the picker under the
composer) switches the model mid-conversation. `/mcp` lists the session's MCP
servers with their status and tools, without spending a turn. Commands that
only make sense in a terminal, such as `/vim`, are left out, and say so if
typed anyway.

A server that "needs sign-in" has a **Sign in** button when it speaks OAuth
over HTTP. Press it, then open the sign-in page it shows; the provider sends
your browser back to AgentOS and the server reconnects in the same session,
with its tools, from a phone or iPad as well as the Mac. A server that only
accepts a sign-in returning to the machine running the session shows a field
to paste the address of the page you land on; claude.ai connectors finish on
claude.ai, then press **Check again**. The tokens stay with Claude Code. A chat
that runs on another linked machine, or whose agent isn't running, says so.

Type `@` for files and folders, matched the way Claude Code matches them
(ripgrep over the folder until the agent is running), and pick one to insert
`@path`. After each turn but the first, the agent's guess at your next message
shows in the empty composer: **Tab** or **→** takes it, typing or **Esc** sets
it aside; on a phone it's a chip to tap. **↑** and **↓** in an empty composer
walk back through what you've sent. Select text in a reply and **Quote** puts
it in the composer as a blockquote.

A message sent while the agent is working waits in a queue above the
composer, kept on the server so a reload doesn't lose it, and goes when the
turn ends, or as soon as the running step is moved to the background (the
agent can take input again). Queued messages can be edited, moved or removed, and **Send now**
stops the turn (as Esc does) and sends that one with the stop, so it's the
very next thing the agent reads, ahead of a background task's notice it had
waiting. A message typed right after Esc goes the same way.

**Plan mode** (the **Plan** toggle under the composer, or Shift+Tab) has the
agent read and plan without changing anything; it's remembered per session.
When the agent has a plan it shows up as a card: **Carry it out** leaves plan
mode and starts it, **Keep planning** goes back to the composer.

The ring in the tab bar (in the composer on a phone) is how full the
conversation's context is, measured against the room before auto-compact:
amber past 60%, red past 85%. Tap it for the breakdown and **Compact now**.

Two thresholds (Settings → Workspaces → Compact; 0 turns one off). Mid-turn,
the agent compacts itself at 300k by default: AgentOS launches Claude Code
with `CLAUDE_CODE_AUTO_COMPACT_WINDOW` set to that size (its floor is 100k),
high enough that a long job isn't cut in half. Your own sessions, in a chat
or a terminal, have a separate mid-turn size (a terminal can't be compacted
between turns, so that is the only compaction it gets); a session already
open keeps the size it was launched with. Between
turns AgentOS catches what it didn't: a chat over its 150k threshold is compacted
before the next message, and so is one idle past its prompt cache (5 minutes
or an hour, read from the agent's own usage), whose next message would
re-read the whole conversation at the cache-write price. A chip above the
composer says "Idle 47m · 412k context · Compacts when you send": Send compacts
and then sends, **Skip once** skips it for that one message. While it compacts, the
status under your message says "Compacting first" instead of "Starting the agent". Messages nobody is
typing (the orchestrator's `send`, AgentOS events and wakes, `aos send`,
schedules) compact first on their own, only between turns, and the chat
shows one quiet line with the context before and after. An orchestrator
isn't compacted (a summary would lose the fence around what it read from
tasks and CI): it starts a fresh conversation from its brief and the current
state at its fresh-start threshold, or earlier once idle past its cache.
While a chat compacts (any trigger, Claude, Pi or Codex) it is shown as
compacting, not just working: a pulsing blue dot and a "Compacting" chip in
the sidebar, and "Compacting context… 182k tokens" above the composer. The
status API (`/api/sessions/status`) keeps `status: "running"` and adds
`compacting: { since, before? }`; the orchestrator's `sessions` tool says
"compacting context". It clears when the compaction ends, errors, is
stopped, or the worker goes away.
What survives a compaction: the summary is asked to keep the task, scope
changes, every edited file by path, what's done, in progress and next, and
the decisions. Right after it, AgentOS hands back a note built from its own
records (a task's brief and scope changes, the files it edited, its todos,
the latest message and `git status`), which doesn't depend on what the
summary kept, and tells the agent not to re-read or rewrite whole files.
Terminal agents don't get the note yet.
On a desktop browser the screen button attaches a screenshot of a screen or
window you pick; on a phone, attach a screenshot as a photo.

**Files.** The paperclip, a paste or a drag-drop also take PDFs, spreadsheets
(xlsx, xls, csv, tsv), Word and other documents (docx, doc, pptx, odt, rtf),
and text, markdown, JSON and code files, up to 8 per message and 25 MB each.
A file uploads as soon as you attach it, shows as a chip (icon, name, size)
you can remove before sending, and a wrong type or a too-big file is refused
there with a message. The server decides the types and sizes; the app reads
them from `/api/client-config`. The file is kept in a per-session folder in
AgentOS's data folder, outside your repo, so it's never committed, and it goes
when the session is deleted. Every agent gets the file's absolute path in the
message, to open with its own tools (a spreadsheet through a script, a docx
through pandoc); Claude also gets a PDF up to 10 MB as a document it reads
directly. A session running on a linked machine can't take files yet (images
still work). In a terminal session, dropping a file pastes its path into the
prompt, as before.

**Usage** (the sidebar's ⋯ menu, or the palette) shows the account's 5-hour
and weekly windows, and what chats cost today, over 7 or 30 days, by day,
workspace and session. Costs are the agent's own estimates, recorded as each
turn ends. **Gate reviews** below it shows what the orchestrator's
independent reviewer and scope check cost, by PR: they run as `claude -p`
and leave no transcript, so each run's tokens, model and duration are read
from its JSON result into `check_runs`, and the review's verdict says them
too. Every compaction is kept in `chat_compactions` (who ran it, whether it
fired `mid_turn` or `between_turns`, and the context before and after), so cost per task can be compared by date.
Rows from before the column existed, and any written by a chat worker still
running older code, have a NULL `phase`: read those as unknown
(`COALESCE(phase, 'unknown')`), not as either kind.

**Esc** stops a running turn, as it does in Claude Code's terminal, unless a
menu, dialog or the command list is open (those close first). On a phone the
Stop button does the same. A stopped turn keeps what it wrote.

Stop ends the turn even while the model is still thinking, before any tool
call: the turn is interrupted, and if it hasn't ended within a few seconds the
agent process is ended and restarted for the next message (not if the chat is
waiting on an approval or question, or if a new message has started a new
turn meanwhile). The conversation and
worktree are kept, and whatever is sent next (yours, another agent's, the
orchestrator's) runs as the next turn, never queued behind the stopped one.
The UI, the orchestrator's `stop` tool and `aos stop` all take this one path
and report "stopped" or a real error.

A turn that has produced nothing (no token, tool call or result) for 8 minutes
shows as **Stalled** in the session list, and its workspace's orchestrator gets
one event naming the session, how long it has been silent and its last action.
It fires once per stall and starts over when the session does something. A
foreground tool call gets four times as long, and a session waiting on a
background command it started isn't flagged. Set the time (2 to 120 minutes, 0 for off)
in Settings → Workspaces → Stall alerts.

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

**Visuals.** Every chat agent has two tools: `html_preview` renders a page in
headless Chrome and hands back a screenshot plus the console, so it can check
its own work, and `html_render` shows the finished page (a chart, a table, a
mockup) inline as its own card, with full screen and "open in new tab". An orchestrator has them too (with a shorter brief), so it can make a page, such as instructions or a report, for you to share. Pages
are kept under `~/.agent-os/artifacts/<session>/` with a row in SQLite, so
they survive reloads and restarts (`GET /api/sessions/<id>/artifacts` lists
them). Re-rendering a page (`update: <artifact id>`, or the same title in
the same chat) adds a version instead of replacing it: every version is kept,
each card shows the one its turn made with a "v1 of 3" chip and a way to the
latest, and the Artifacts view lists the page once with a version switcher
(`GET /api/artifacts/<id>/versions`) and the same actions as the card (full
screen, share, open, download), each acting on the version on screen. A
share link is a snapshot of that version. They're served behind the same device gate with a CSP sandbox and no
same-origin access, so a page can't read AgentOS cookies or call its API; the
preview browser gets an empty profile and a proxy that only reaches public
addresses. An image or SVG file the agent writes shows inline when its reply
links to it by absolute path. The tools read files and reach the web, so
under **Ask first** they ask like any other tool. Previews need Chrome, Chromium, Brave or Edge
installed (or `AGENTOS_CHROME` pointing at one).

Chat runs on this machine, and on linked machines through their own AgentOS
(see [Machines](https://github.com/saadnvd1/agent-os/blob/main/docs/reference/machines.md)); sessions on machines reached over ssh only use
the terminal.

**Bookmarks** mark a single message to come back to. Star a message, a
tool call or a whole turn (on its end line), or hold a message on a phone.
The star in the chat's header lists that chat's bookmarks in order and jumps
to one, loading older history to reach it. **Bookmarks** in the sidebar menu
or the palette lists every chat's, by workspace or all, with a search over the
text, your note and the chat's name. A bookmark keeps a copy of the text with
secrets masked, so it stays readable after `/compact`, an archive, a move to
another machine, or the chat being deleted. Bookmarks are yours: they don't
pin the chat, and agents don't see them. The API is `GET/POST
/api/sessions/:id/bookmarks`, `GET /api/bookmarks`, and `PATCH/DELETE
/api/bookmarks/:id`.

**Search every conversation.** ⌘K (Ctrl+K off a Mac) opens the palette; type
two letters and the best matching conversations are listed under the
commands, and Tab (or "Search all conversations") opens the full search. It
looks at what you and the agent said (not tool calls or their output) in
every chat, including done, dropped and archived ones, in the current
workspace or all of them. A word matches by its start, so `compac` finds
"compaction", and quotes match a phrase. The selected result shows its message
with the ones around it; Enter, or a tap on a phone, opens the chat at that
message, which flashes. An archived chat comes back first, as it does from a
bookmark. Terminal sessions are not searched. Older chats are indexed in the
background after an update, and the search says so while it runs. The API is
`GET /api/search/conversations?q=&workspace=&project=` and
`GET /api/search/conversations/context?session=&item=`.

Drivers for other agent CLIs plug into `lib/chat/drivers`; undo, `@file`
suggestions and visuals are Claude-only for now, and plan mode is Claude and
OpenCode.
