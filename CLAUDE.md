# AgentOS

Self-hosted web UI for managing multiple AI coding CLI sessions.

## Supported Agents

- **Claude Code** (Anthropic) - `claude` CLI with resume/fork support
- **Codex** (OpenAI) - `codex` CLI with approval modes
- **OpenCode** - `opencode` CLI with multi-provider support

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
- Provider abstraction for multi-CLI support (`lib/providers.ts`)

## Key Files

- `server.ts` - WebSocket server entry point
- `lib/db.ts` - Database schema (sessions, groups, messages)
- `lib/providers.ts` - Agent provider abstraction (Claude, Codex, OpenCode)
- `lib/panes.ts` - Multi-pane layout types
- `contexts/PaneContext.tsx` - Pane/tab state management
- `components/PaneLayout.tsx` - Resizable pane renderer (react-resizable-panels)
- `components/Pane.tsx` - Individual pane with tabs and toolbar
- `components/SessionList.tsx` - Grouped session sidebar
- `components/Terminal.tsx` - xterm.js wrapper
- `app/api/sessions/status/route.ts` - Session status detection from tmux

## Session Management

Sessions are managed through tmux:
- Each session runs in `{provider}-{uuid}` tmux session (e.g., `claude-abc123`, `codex-def456`)
- Agent type stored in database, defaults to Claude
- Provider-specific flags handled by `lib/providers.ts`
- Claude session IDs detected from `~/.claude/projects/` files
- Forking uses `--resume {parentId} --fork-session` (Claude only)
- Skip permissions stored in localStorage

## Standards

- Conventional commits (feat, fix, docs, etc.)
- Run typecheck before committing
- Purple theme (HSL hue 270)
