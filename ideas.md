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

## Chat (after V1)

- [ ] Drivers for Codex, OpenCode and others (lib/chat/drivers)
- [ ] Approval prompts and plan mode as an opt-in permission level
- [ ] Import turns made in the terminal when switching back to chat
- [ ] "Open as chat" for tmux sessions AgentOS didn't start: find the Claude
      conversation running there, create a session that resumes it in chat,
      and close the tmux session
- [ ] Chat for sessions on other machines (via the per-machine AgentOS)
- [ ] Checkpoints: undo a turn's file changes
- [ ] Model picker and context-usage meter in the composer

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

## Integration

- [ ] tmux session linking - Attach Claude to existing tmux sessions
- [ ] Git integration - Show repo status in session header
- [ ] File browser - Browse working directory
- [ ] Image/file upload support
- [ ] Voice input/output
