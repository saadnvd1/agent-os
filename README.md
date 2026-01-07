# AgentOS

A self-hosted web UI for managing multiple AI coding assistant sessions with multi-pane terminals, session groups, and conversation forking.

![AgentOS Screenshot](docs/screenshot.png)

## Supported Agents

- **Claude Code** (Anthropic) - Full support with resume/fork
- **Codex** (OpenAI) - Basic support with approval modes
- **OpenCode** - Basic support for multi-provider CLI

## Features

- **Multi-Agent Support** - Switch between Claude, Codex, and OpenCode per session
- **Multi-Pane View** - Run up to 4 sessions side-by-side with resizable panes
- **Session Groups** - Organize sessions in collapsible folder hierarchy
- **Tabbed Terminals** - Multiple tabs per pane for quick switching
- **Session Forking** - Fork conversations to explore different approaches (Claude)
- **Session Resume** - Auto-detects session IDs for seamless resume (Claude)
- **Skip Permissions** - Optional flag to bypass permission prompts
- **External Session Import** - Import existing tmux sessions
- **tmux Integration** - Sessions persist across page reloads

## Prerequisites

- Node.js 20+
- tmux
- At least one of:
  - [Claude Code CLI](https://github.com/anthropics/claude-code) installed and authenticated
  - [Codex CLI](https://github.com/openai/codex) installed and authenticated
  - [OpenCode CLI](https://github.com/opencode-ai/opencode) installed and configured
- macOS or Linux

## Quick Start

```bash
# Clone the repository
git clone https://github.com/saadnvd1/agent-os
cd agent-os

# Install dependencies
npm install

# Start development server
npm run dev

# Open http://localhost:3011
```

## How It Works

AgentOS manages AI coding CLI sessions through tmux. Each session runs in its own tmux session (`{agent}-{uuid}`), allowing:

- **Persistence** - Sessions survive browser refreshes and server restarts
- **Resume** - Pick up conversations where you left off (Claude: `--resume`)
- **Fork** - Branch conversations using `--fork-session` (Claude only)
- **Multi-Agent** - Choose between Claude, Codex, or OpenCode when creating sessions

The web UI provides an xterm.js terminal connected to tmux, with a sidebar for session management. Provider-specific flags are handled automatically via the abstraction in `lib/providers.ts`.

## Architecture

```
Browser (React 19)
├── PaneLayout (resizable panels)
│   └── Pane (tabs + terminal)
├── SessionList (grouped sidebar)
└── Terminal (xterm.js)
         │
         │ WebSocket (/ws/terminal)
         ▼
server.ts (Next.js + node-pty)
         │
         ▼
tmux sessions → AI CLI (claude/codex/opencode)
         │
         ▼
SQLite (sessions, groups, agent_type)
```

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Run production server
- `npm run typecheck` - TypeScript type checking

## Tech Stack

- **Framework**: Next.js 15 + React 19
- **Language**: TypeScript
- **Database**: SQLite (better-sqlite3)
- **Terminal**: xterm.js + node-pty
- **Panels**: react-resizable-panels
- **Styling**: Tailwind CSS 4 + shadcn/ui

## Configuration

Environment variables (optional):

- `PORT` - Server port (default: 3011)
- `DB_PATH` - SQLite database path (default: ./agent-os.db)

## License

MIT
