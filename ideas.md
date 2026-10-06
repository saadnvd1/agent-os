# Agent-OS Future Ideas

## Features

- [ ] Notifications - Alert when session needs attention (waiting state, errors, completed tasks)
- [ ] MCP server integration - Toggle AI capabilities (web search, GitHub) per session
- [ ] Session templates - Pre-configured sessions for common tasks
- [ ] Session groups - Organize sessions into projects/folders
- [ ] Session search - Fuzzy search across all conversations
- [ ] Export conversations - Export to Markdown/JSON
- [ ] Keyboard shortcuts - Quick navigation and actions
- [x] Mobile responsive - Better mobile layout
- [ ] Dark/light theme toggle

## Machines (after multi-host V1)

- [ ] Files, git and worktrees for sessions on other machines (run git over the host exec layer)
- [ ] Persist pane layouts per workspace in the DB instead of localStorage
- [ ] Merge "groups" into projects (one concept)
- [ ] Attention queue: pin sessions waiting on you to the top
- [ ] Resume Claude after a reboot from a recorded session id
- [ ] Replace status polling with tmux hooks/control mode events

## Tasks (after V1, 2026-10-05)

- [ ] Run tasks on other machines (worktree + tmux over the host exec layer)
- [ ] Notify (push/Telegram) when a task needs you or is ready for review
- [ ] Model picker and per-project brief additions in New task
- [ ] Answer a blocked task from the panel without opening the terminal
- [ ] Resume an exited task with `claude --resume`
- [ ] Per-task dev server port and database, as dispatch does

## Composer follow-ups (from PR #84 review)

- [ ] Reset the pasted-text attachment counter after sending, so a new message starts at pasted-text.txt
- [ ] Keep NUL characters in pasted text (the lazy-line marker uses \u0000 and strips them)
- [ ] Decide on CRLF: pasted Windows line endings are normalised to LF
- [ ] Tests: typing in the editor serialises to what was typed; a broken draft loads as plain text

## Workspace orchestrator

- [ ] One standing orchestrator per workspace: see docs/plans/workspace-orchestrator.md
      (after stacks and the TipTap composer ship)

## Chat (after V1)

- [ ] Drivers for Codex, OpenCode and others (lib/chat/drivers)
- [x] Approval prompts as an opt-in permission level (access picker)
- [ ] Plan mode: `/plan`, a proposed-plan card, and "build it" to switch access
- [ ] Import turns made in the terminal when switching back to chat
- [ ] "Open as chat" for tmux sessions AgentOS didn't start: find the Claude
      conversation running there, create a session that resumes it in chat,
      and close the tmux session
- [ ] Chat for sessions on other machines (via the per-machine AgentOS)
- [x] Checkpoints: undo a turn's file changes
- [ ] Undo for shell-command changes too (git stash/snapshot per turn), since
      SDK checkpoints only cover the file-edit tools
- [ ] Context-usage meter in the composer
- [x] Durable chat: run each chat conversation
      in its own worker process (hosted in tmux, like terminal sessions) so a
      server restart no longer kills a turn in flight. The worker owns the
      agent and writes every item to SQLite before it's shown; the server
      becomes a viewer that reattaches after a restart, and the worker
      resumes an interrupted turn when it starts. Sends carry an id so a
      retried send is never run twice. (Done 2026-10-06, no flag.)
- [ ] Resume a turn when its worker itself crashed (the worker, not the
      server): record the in-flight send and re-send it on the next start

## Tooling

- [ ] Refactor the 21 React Compiler warnings (set-state-in-effect, refs) and make them errors

## Technical

- [ ] Message streaming improvements - Better partial message handling
- [ ] Tool call persistence - Store tool calls in database
- [ ] Session snapshots - Save/restore session state
- [ ] Multiple working directories per session
- [ ] Claude model selection per session
- [ ] Rate limiting / queue for parallel sessions
- [ ] WebSocket reconnection handling
- [ ] Session auto-save/recovery

## Workspaces (inspired by catnip)

- [ ] Project-tied workspaces - Sessions grouped by project, not just folders
- [ ] Auto dev server management - Each worktree gets its own dev server with unique port
- [ ] Parallel development environments - Run multiple features simultaneously with isolated servers
- [ ] Workspace dashboard - See all active worktrees, their branches, ports, and session status
- [ ] One-click environment spin-up - Create worktree + session + dev server in single action
- [ ] Port forwarding UI - View/manage all running dev servers across worktrees
- [ ] Worktree health monitoring - Track build status, test results per environment

## LumifyHub (after V1, 2026-10-06)

- [ ] Tokens scoped to one workspace, so a connected AgentOS can't touch the rest of the account
- [ ] Webhooks from LumifyHub so card changes reach AgentOS without polling
- [ ] A deep link to a workspace's members/invites settings (LumifyHub has no URL for it yet)
- [ ] Agents read and write their own card (status notes, checklists) through `aos`
- [ ] Re-publish refreshes the page in LumifyHub's editor (an open editor keeps showing old text)

## Integration

- [ ] tmux session linking - Attach Claude to existing tmux sessions
- [ ] Git integration - Show repo status in session header
- [ ] File browser - Browse working directory
- [ ] Image/file upload support
- [ ] Voice input/output
