# AgentOS

A **mobile-first** self-hosted web UI for managing multiple AI coding assistant sessions. Built for developers who need to manage AI coding sessions on the go from their phones.

> If you find AgentOS useful, please consider giving it a star! It helps the project grow and reach more developers.

![AgentOS Screenshot](docs/screenshot.png)

## Why AgentOS?

Most AI coding tools assume you're at a desktop. AgentOS is designed for developers who need **full functionality from their mobile device** - not just a dumbed-down "responsive" version.

- **Primary device**: Phone (iOS/Android)
- **Primary context**: On the go, away from your desktop
- **Primary need**: Everything desktop users have, adapted for touch

## Supported Agents

- **Claude Code** (Anthropic) - Full support with resume/fork
- **Codex** (OpenAI) - Basic support with approval modes
- **OpenCode** - Basic support for multi-provider CLI
- **Gemini CLI** (Google) - Basic support for Gemini models
- **Aider** - AI pair programming with multi-LLM support
- **Cursor CLI** - Cursor's AI agent in the terminal

## Features

### Mobile-First Terminal
- **Virtual Keyboard** - 3 modes: Quick keys (common shortcuts), ABC, Numbers
- **Touch-Optimized Scrolling** - Smooth scrolling in both normal and alternate buffers
- **Shift+Enter Support** - Multi-line input in Claude Code CLI
- **Image Picker** - Browse server filesystem to select images for Claude Code

### Session Management
- **Multi-Agent Support** - Switch between Claude, Codex, OpenCode, Gemini, Aider, and Cursor per session
- **Auto-Import tmux Sessions** - Existing Claude/Codex/Aider sessions detected on startup
- **Session Preview on Hover** - Quick preview of session terminal state
- **Status Detection** - Real-time running/waiting/idle status with spike filtering
- **Browser Notifications** - Get notified when sessions need input

### Multi-Pane Layout
- **Multi-Pane View** - Run up to 4 sessions side-by-side with resizable panes
- **Session Groups** - Organize sessions in collapsible folder hierarchy
- **Tabbed Terminals** - Multiple tabs per pane for quick switching

### Project Organization
- **Projects** - Group sessions by project with shared settings
- **Working Directory** - Each project has a default working directory
- **Directory Picker** - Browse filesystem to select directories visually
- **Inline Creation** - Create new projects directly from the new session dialog
- **Dev Server Integration** - Each project can have configured dev servers

### Dev Server Management
- **Node.js Servers** - Start/stop/restart npm/yarn/pnpm dev servers
- **Docker Compose** - Support for Docker-based development environments
- **Port Management** - Automatic port assignment and tracking
- **Server Logs** - View real-time logs from running servers
- **Stop Confirmation** - Safety confirmation before stopping servers

### Git Integration
- **Git Status Panel** - View staged/unstaged/untracked files
- **Inline Diff Viewer** - Tap files to see unified diffs
- **Swipe to Stage** - Mobile-friendly staging gestures
- **Commit & Push** - Full git workflow from the UI
- **PR Integration** - Create PRs and track status (requires `gh` CLI)

### Git Worktrees
- **Isolated Branches** - Each worktree gets its own feature branch
- **Auto Environment Setup** - Copies `.env*` files, installs dependencies
- **Unique Dev Ports** - Each worktree gets assigned a port (3100, 3110...)

### Session Orchestration
- **Conductor/Worker Model** - Spawn worker sessions with isolated worktrees via MCP
- **Worker Status Tracking** - Monitor worker progress from conductor view

### Developer Experience
- **ASCII Banner** - Custom AgentOS branding on session start
- **Custom tmux Status Bar** - AgentOS-themed status bar with session info
- **File Explorer** - Browse project files with syntax highlighting
- **Session Forking** - Fork conversations to explore different approaches (Claude)
- **Session Resume** - Auto-detects session IDs for seamless resume (Claude)

## Prerequisites

- Node.js 20+
- tmux
- At least one of:
  - [Claude Code CLI](https://github.com/anthropics/claude-code) installed and authenticated
  - [Codex CLI](https://github.com/openai/codex) installed and authenticated
  - [OpenCode CLI](https://github.com/opencode-ai/opencode) installed and configured
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed and authenticated
  - [Aider](https://aider.chat/) installed and configured
  - [Cursor CLI](https://cursor.com/cli) installed (requires Cursor subscription)
- [GitHub CLI](https://cli.github.com/) (`gh`) - Optional, for PR integration
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
- **Multi-Agent** - Choose between Claude, Codex, OpenCode, Gemini, Aider, or Cursor when creating sessions

The web UI provides an xterm.js terminal connected to tmux, with a sidebar for session management. Provider-specific flags are handled automatically via the abstraction in `lib/providers.ts`.

## Git Worktrees

When creating a session in a git repository, you can enable "Create isolated worktree" to:

1. **Create a feature branch** - Automatically generates `feature/{name}` branch
2. **Isolated directory** - Worktree created in `~/.agent-os/worktrees/`
3. **Auto-setup environment** - Copies `.env*` files and runs package manager install
4. **Unique dev port** - Each worktree gets assigned a port (3100, 3110, etc.)
5. **PR workflow** - Create PRs directly from the session menu

### Configuration (Optional)

Create `.agent-os/worktrees.json` in your project to customize setup:

```json
{
  "setup": [
    "cp $ROOT_WORKTREE_PATH/.env.local .env.local",
    "pnpm install",
    "npm run db:migrate"
  ],
  "devServer": {
    "command": "npm run dev",
    "portEnvVar": "PORT"
  }
}
```

Without a config file, AgentOS auto-detects your package manager and copies `.env*` files automatically.

## Architecture

```
Browser (React 19)
├── PaneLayout (resizable panels)
│   └── Pane (tabs + terminal/files/git views)
├── SessionList (projects + sessions sidebar)
│   ├── ProjectsSection (project organization)
│   └── DevServerCard (server status/controls)
├── Terminal (xterm.js + virtual keyboard)
├── FileExplorer (project browser)
├── GitPanel (status + diff viewer)
├── DirectoryPicker (filesystem browser)
└── ImagePicker (server filesystem browser)
         │
         │ WebSocket (/ws/terminal)
         ▼
server.ts (Next.js + node-pty)
         │
         ├── tmux sessions → AI CLI (claude/codex/opencode/aider)
         └── dev servers → child_process (node/docker)
         │
         ▼
SQLite (sessions, projects, dev_servers)
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

Business Source License 1.1 (BUSL-1.1)

- **Allowed**: View, modify, fork, non-production use
- **Not allowed**: Any production use without a commercial license
- **Converts to MIT** on January 1, 2029

See [LICENSE](LICENSE) for full terms. For commercial licensing, contact: saad@lumifyhub.io
