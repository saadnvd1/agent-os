# AgentOS

Self-hosted web UI for managing multiple Claude Code sessions.

## Commands

- `npm run dev` - Start dev server on port 3011
- `npm run build` - Build for production
- `npm start` - Run production server
- `npm run typecheck` - TypeScript type checking

## Architecture

- Next.js 15 + React 19 + TypeScript
- Custom server.ts with WebSocket endpoint for terminal PTY
- SQLite via better-sqlite3 for persistence
- tmux for session management
- Claude Code CLI with `--resume` and `--fork-session` flags

## Key Files

- `server.ts` - WebSocket server entry point
- `lib/db.ts` - Database schema (sessions, groups, messages)
- `lib/panes.ts` - Multi-pane layout types
- `contexts/PaneContext.tsx` - Pane/tab state management
- `components/PaneLayout.tsx` - Resizable pane renderer (react-resizable-panels)
- `components/Pane.tsx` - Individual pane with tabs and toolbar
- `components/SessionList.tsx` - Grouped session sidebar
- `components/Terminal.tsx` - xterm.js wrapper
- `app/api/sessions/status/route.ts` - Claude session ID detection from files

## Session Management

Sessions are managed through tmux:
- Each session runs in `claude-{uuid}` tmux session
- Claude session IDs detected from `~/.claude/projects/` files
- Forking uses `--resume {parentId} --fork-session`
- Skip permissions stored in localStorage

## Standards

- Conventional commits (feat, fix, docs, etc.)
- Run typecheck before committing
- Purple theme (HSL hue 270)
