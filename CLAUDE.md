# agent-os

Web-based AI agent command center for managing Claude Code sessions.

## Commands

- `npm run dev` - Start dev server (tsx server.ts)
- `npm run build` - Build for production
- `npm start` - Run production server
- `npm run lint` - Run ESLint
- `npm run typecheck` - TypeScript type checking
- `/commit` - Create conventional commit
- `/setup` - Set up environment

## Architecture

- Next.js 16 + React 19 + TypeScript
- Custom server.ts with dual WebSocket endpoints:
  - `/ws/terminal` - node-pty shell access
  - `/ws/claude/{sessionId}` - Claude streaming
- SQLite via better-sqlite3 for persistence
- Claude Code CLI integration with `--output-format stream-json`

## Key Files

- `server.ts` - WebSocket server entry point
- `lib/db.ts` - Database schema and queries (sessions, groups)
- `lib/panes.ts` - Multi-pane layout types and helpers
- `contexts/PaneContext.tsx` - Pane state management
- `components/PaneLayout.tsx` - Resizable pane renderer
- `components/Pane.tsx` - Individual pane with toolbar
- `components/SessionList.tsx` - Grouped session sidebar
- `components/Terminal.tsx` - xterm.js wrapper

## Standards

- Conventional commits (feat, fix, docs, etc.)
- Run typecheck before committing
- Keep code simple and readable
