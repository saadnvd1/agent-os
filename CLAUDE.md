# AgentOS

Self-hosted web UI for managing multiple AI coding CLI sessions.

## Target Users: Mobile-First, On-the-Go Developers

**CRITICAL DESIGN PRINCIPLE:** AgentOS is designed for developers who need to manage AI coding sessions **on the go from their mobile devices**. Every feature must work well on mobile, not just be "responsive."

When implementing any feature:
- **Primary device:** Phone (iOS/Android)
- **Primary context:** On the go, away from desktop
- **Primary need:** Full functionality, not a subset

If a feature exists in desktop tools (Emdash, VS Code, etc.), figure out how to make it work **simply on mobile** - don't skip it. Examples:
- Multi-pane layout → Single pane + bottom tabs
- Hover menus → Touch-friendly buttons (44x44px min)
- Side-by-side diffs → Unified diff view
- Keyboard shortcuts → Quick action toolbar
- Monaco editor → Read-only syntax viewer

**Mobile users need:**
- File browsing and viewing
- Git workflows (status, staging, diffs, commits, PRs)
- Dev server management
- Terminal interaction with touch optimizations
- All features that desktop users have, adapted for mobile

See `master.md` for full transformation plan.

---

## Supported Agents

- **Claude Code** (Anthropic) - `claude` CLI with resume/fork support
- **Codex** (OpenAI) - `codex` CLI with approval modes
- **OpenCode** - `opencode` CLI with multi-provider support
- **Gemini CLI** (Google) - `gemini` CLI powered by Gemini models
- **Aider** - `aider` CLI for AI pair programming
- **Cursor CLI** - `cursor-agent` CLI from Cursor

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
- `lib/status-detector.ts` - Session status detection with spike filtering
- `lib/notifications.ts` - Browser notifications and sound alerts
- `lib/panes.ts` - Multi-pane layout types
- `lib/worktrees.ts` - Git worktree creation/deletion
- `lib/git.ts` - Git utilities (branch detection, repo checks)
- `lib/env-setup.ts` - Worktree environment setup (env files, package install)
- `lib/ports.ts` - Dev server port management (3100-3900 range)
- `contexts/PaneContext.tsx` - Pane/tab state management
- `hooks/useNotifications.ts` - Notification state changes and browser alerts
- `components/PaneLayout.tsx` - Resizable pane renderer (react-resizable-panels)
- `components/Pane.tsx` - Individual pane with tabs and toolbar
- `components/SessionList.tsx` - Grouped session sidebar
- `components/Terminal.tsx` - xterm.js wrapper
- `app/api/sessions/status/route.ts` - Session status API endpoint
- `app/api/sessions/[id]/pr/route.ts` - GitHub PR creation/status via `gh` CLI
- `lib/orchestration.ts` - Conductor/worker session spawning
- `lib/mcp-config.ts` - Auto-generate MCP config for sessions
- `mcp/orchestration-server.ts` - MCP server for spawning workers
- `components/ConductorPanel.tsx` - Workers view for conductor sessions

## Session Management

Sessions are managed through tmux:
- Each session runs in `{provider}-{uuid}` tmux session (e.g., `claude-abc123`, `codex-def456`)
- Agent type stored in database, defaults to Claude
- Provider-specific flags handled by `lib/providers.ts`
- Claude session IDs detected from `~/.claude/projects/` files
- Forking uses `--resume {parentId} --fork-session` (Claude only)
- Skip permissions stored in localStorage

## Git Worktrees

Worktree sessions create isolated git branches for parallel feature development:
- Worktrees stored in `~/.agent-os/worktrees/{project}-{feature}`
- Auto-setup: copies `.env*` files, runs package manager install
- Port assignment: each worktree gets unique port (3100, 3110, 3120...)
- PR integration: Create PR button uses `gh` CLI, tracks PR status

Config file (`.agent-os/worktrees.json` or `.agent-os.json`):
```json
{
  "setup": ["cp $ROOT_WORKTREE_PATH/.env.local .env.local", "pnpm install"],
  "devServer": { "command": "npm run dev", "portEnvVar": "PORT" }
}
```

## Status Detection

Session status is detected via `lib/status-detector.ts`:
- **running** (green) - Sustained activity or busy indicators detected
- **waiting** (yellow) - Needs user input (approval prompts, Y/n questions)
- **idle** (gray) - No recent activity, user has seen it
- **dead** - tmux session doesn't exist

Detection uses:
1. Waiting patterns in last 5 lines (highest priority)
2. Busy indicators ("esc to interrupt", spinners) with recent activity check
3. Spike detection (2+ timestamp changes in 1s = sustained activity)
4. 2s cooldown after activity stops

## Session Orchestration

Conductors can spawn worker sessions with isolated worktrees:
- Workers get their own git branch and worktree in `~/.agent-os/worktrees/`
- MCP server (`mcp/orchestration-server.ts`) exposes tools: `spawn_worker`, `list_workers`, `get_worker_output`
- `.mcp.json` auto-generated when attaching to sessions
- Workers shown nested under conductor in sidebar with badge count
- Terminal/Workers view toggle in Pane header for conductors

## Code Style

### General Rules
- Use **TypeScript everywhere** - never use `any`
- Keep code as simple and concise as possible unless complexity is needed
- Break down large components into sub-components
- Extract shared logic into hooks **only if used in multiple places**
- In `useEffect` dependencies, be mindful that object references change on re-render; prefer primitives or memoized objects to avoid duplicate runs
- Do not add unnecessary comments - if code is self-explanatory, don't add a comment
- Use absolute imports: `import { X } from "@/lib/x"` not relative `../lib/x`

### Component Organization
- Components go in `components/` with subdirectories for features (e.g., `components/FileExplorer/`)
- Shared hooks go in `hooks/`
- Business logic goes in `lib/` as pure functions
- API routes go in `app/api/`

### API Routes
- API routes should be **orchestrators**, not contain heavy business logic
- Business logic should live in `lib/` modules
- Use Zod schemas for request validation when appropriate
- Keep routes thin: validate → call lib function → return response

### React Patterns
- Prefer functional components with hooks
- Use `useState` for local state, context for shared state
- Keep state as close to where it's used as possible
- Memoize expensive computations with `useMemo`, callbacks with `useCallback`

## Standards

- Conventional commits (feat, fix, docs, etc.)
- Run typecheck at end of each phase and fix all errors
- Purple theme (HSL hue 270)
- **NEVER mention competitor products (Emdash, Cursor, etc.) in code comments or documentation**
- This file (CLAUDE.md) is gitignored - it's for development only, not in the open source repo
