# Agent-OS

A web-based AI agent command center for managing multiple Claude Code sessions with structured streaming output and embedded terminal access.

## Features

- **Session Management** - Create, list, and switch between Claude sessions
- **Session Groups** - Organize sessions in collapsible folder hierarchy
- **Multi-Pane View** - View up to 4 sessions simultaneously with resizable panes
- **Session Forking** - Fork conversations with inherited context
- **Structured Chat UI** - Parse Claude's stream-json into messages, tool calls, and results
- **Embedded Terminal** - Full xterm.js terminal for direct shell access
- **SQLite Persistence** - Local database for session metadata and history
- **tmux Integration** - Sessions run in tmux for persistence across page reloads

## Architecture

```
Browser (React 19)
├── SessionList (sidebar)
├── ChatView (Claude stream-json → structured messages)
└── Terminal (xterm.js for shell access)
         │
         │ WebSocket
         ▼
Custom server.ts
├── /ws/terminal → node-pty
└── /ws/claude/{sessionId} → ClaudeProcessManager
     └── spawns: claude -p --output-format stream-json
         │
         ▼
SQLite (better-sqlite3)
├── sessions
├── messages
└── tool_calls
```

## Prerequisites

- Node.js 20+
- tmux (for session persistence)
- Claude Code CLI installed and authenticated
- jq (for parsing Claude session IDs)
- macOS/Linux (for node-pty)

## Getting Started

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

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Run production server
- `npm run lint` - Run ESLint
- `npm run typecheck` - Run TypeScript type checking

## Tech Stack

- **Framework**: Next.js 16 + React 19
- **Language**: TypeScript
- **Database**: SQLite via better-sqlite3
- **Terminal**: xterm.js + node-pty
- **WebSocket**: ws
- **Styling**: Tailwind CSS 4 + shadcn/ui
- **Claude Integration**: Claude Code CLI with stream-json output

## Project Structure

```
agent-os/
├── app/
│   ├── page.tsx              # Main dashboard
│   ├── layout.tsx            # Root layout
│   └── api/sessions/         # Session CRUD API
├── components/
│   ├── Terminal.tsx          # xterm.js terminal
│   ├── ChatView.tsx          # Claude chat interface
│   ├── SessionList.tsx       # Session sidebar
│   └── ui/                   # shadcn/ui components
├── lib/
│   ├── db.ts                 # SQLite setup
│   └── claude/
│       ├── types.ts          # Stream-JSON types
│       ├── stream-parser.ts  # NDJSON parser
│       └── process-manager.ts # Claude process spawning
└── server.ts                 # Custom server with WebSocket
```

## Configuration

Environment variables (optional):

- `PORT` - Server port (default: 3011)
- `DB_PATH` - SQLite database path (default: ./agent-os.db)

## License

MIT
