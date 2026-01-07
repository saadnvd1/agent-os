# AgentOS

A self-hosted web UI for managing multiple Claude Code sessions with multi-pane terminals, session groups, and conversation forking.

![AgentOS Screenshot](docs/screenshot.png)

## Features

- **Multi-Pane View** - Run up to 4 Claude sessions side-by-side with resizable panes
- **Session Groups** - Organize sessions in collapsible folder hierarchy
- **Tabbed Terminals** - Multiple tabs per pane for quick switching
- **Session Forking** - Fork conversations to explore different approaches
- **Claude Session Detection** - Auto-detects Claude session IDs from files
- **Skip Permissions** - Optional flag to bypass permission prompts
- **External Session Import** - Import existing tmux Claude sessions
- **tmux Integration** - Sessions persist across page reloads

## Prerequisites

- Node.js 20+
- tmux
- [Claude Code CLI](https://github.com/anthropics/claude-code) installed and authenticated
- jq (for parsing Claude session IDs)
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

AgentOS manages Claude Code sessions through tmux. Each session runs in its own tmux session, allowing:

- **Persistence** - Sessions survive browser refreshes and server restarts
- **Resume** - Pick up conversations where you left off with `--resume`
- **Fork** - Branch conversations using `--fork-session`

The web UI provides an xterm.js terminal connected to tmux, with a sidebar for session management.

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
tmux sessions → Claude Code CLI
         │
         ▼
SQLite (sessions, groups)
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
