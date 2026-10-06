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
- [ ] Merge "groups" into projects (one concept, like mterm's `group` field)
- [ ] Attention queue: pin sessions waiting on you to the top, using mterm's status rules
- [ ] Resume Claude after a reboot from a recorded session id
- [ ] Replace status polling with tmux hooks/control mode events

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
