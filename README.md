# AgentOS

A **mobile-first** self-hosted web UI for managing multiple AI coding assistant sessions. Built for developers who need to manage AI coding sessions on the go from their phones.

> If you find AgentOS useful, please consider giving it a star! It helps the project grow and reach more developers.

> **Don't want to self-host?** Try [AgentOS Cloud](https://runagentos.com) - get a pre-configured cloud VM for AI coding, accessible from any device.

https://github.com/user-attachments/assets/0e2e66f7-037e-4739-99ec-608d1840df0a

![AgentOS Screenshot](docs/screenshot.png)

## Why AgentOS?

Most AI coding tools assume you're at a desktop. AgentOS is designed for developers who need **full functionality from their mobile device** - not just a dumbed-down "responsive" version.

- **Primary device**: Phone (iOS/Android)
- **Primary context**: On the go, away from your desktop
- **Primary need**: Everything desktop users have, adapted for touch

**"But how do you review code without an IDE?"**

AgentOS includes a File Explorer with syntax highlighting and a Git Panel with inline diffs. Browse files, review changes, stage commits - all touch-optimized for mobile.

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
- **Session Preview on Hover** - Quick preview of session terminal state
- **Status Detection** - Real-time running/waiting/idle status with spike filtering
- **Browser Notifications** - Get notified when sessions need input
- **Bulk Selection** - Shift+click to select multiple sessions for bulk delete
- **Mobile Session Switcher** - Tap tab bar to quickly switch between sessions

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
- **Commit History** - Browse last 30 commits with expandable details
- **Historical Diffs** - Click any commit to see files changed, click file to view diff
- **Inline Diff Viewer** - Tap files to see unified diffs (supports merge commits)
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

## Installation

### One-Line Install (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/saadnvd1/agent-os/main/scripts/install.sh | bash
```

This will:

- Install prerequisites (Node.js, git, tmux) if missing
- Prompt to install an AI CLI if none detected
- Build and configure AgentOS
- Add `agent-os` command to your PATH

Then start the server:

```bash
agent-os start
agent-os status   # Shows URLs
```

### CLI Commands

```bash
agent-os run       # Start server and open in browser
agent-os start     # Start server in background
agent-os stop      # Stop server
agent-os restart   # Restart server
agent-os status    # Show status and URLs
agent-os logs      # Tail server logs
agent-os update    # Update to latest version
agent-os enable    # Auto-start on boot
agent-os disable   # Disable auto-start
agent-os uninstall # Remove completely
```

### Manual Install (Development)

```bash
git clone https://github.com/saadnvd1/agent-os
cd agent-os
npm install
npm run dev        # Development mode on http://localhost:3011
```

### Prerequisites

- Node.js 20+
- tmux
- At least one AI coding CLI:
  - [Claude Code](https://github.com/anthropics/claude-code) - Recommended
  - [Codex](https://github.com/openai/codex)
  - [OpenCode](https://github.com/opencode-ai/opencode)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli)
  - [Aider](https://aider.chat/)
  - [Cursor CLI](https://cursor.com/cli)
- [GitHub CLI](https://cli.github.com/) (`gh`) - Optional, for PR integration
- macOS or Linux

## Mobile Access with Tailscale

AgentOS runs on your dev machine, but you want to access it from your phone. [Tailscale](https://tailscale.com) creates a secure mesh network between your devices - no port forwarding or firewall config needed.

### Step 1: Install Tailscale on Your Dev Machine

**macOS:**

1. Download from [tailscale.com/download](https://tailscale.com/download)
2. Sign in with Google/GitHub/etc
3. Note the IP assigned (visible in menu bar) - it looks like `100.x.x.x`

**Linux:**

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale ip  # Note your IP
```

### Step 2: Install Tailscale on Your Phone

1. Download Tailscale from App Store (iOS) or Play Store (Android)
2. Sign in with the **same account**
3. Your dev machine should appear in the device list

### Step 3: Access AgentOS

On your phone's browser, go to:

```
http://100.x.x.x:3011
```

Replace `100.x.x.x` with your dev machine's Tailscale IP.

That's it! The connection is encrypted end-to-end and works from anywhere - home, coffee shop, or mobile data.

**Tip:** Bookmark the URL or add it to your home screen for quick access.

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
