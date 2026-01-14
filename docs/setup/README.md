# AgentOS Setup Guide

This guide covers installing and running AgentOS on your machine.

## Quick Install (Recommended)

Run this one-liner to install AgentOS:

```bash
curl -fsSL https://raw.githubusercontent.com/saadnvd1/agent-os/main/scripts/install.sh | bash
```

The installer will:
1. Download the `agent-os` CLI to your PATH
2. Check for prerequisites (Node.js 20+, git, tmux) and offer to install any missing ones
3. Detect installed AI CLIs or prompt you to install one (Claude Code recommended)
4. Clone the repository to `~/.agent-os/repo`
5. Install dependencies and build for production

## Manual Install

If you prefer to install manually:

```bash
# Clone the repository
git clone https://github.com/saadnvd1/agent-os ~/.agent-os/repo
cd ~/.agent-os/repo

# Install dependencies
npm install

# Build for production
npm run build

# Start the server
npm start
```

## CLI Commands

After installation, use the `agent-os` command to manage the server:

| Command | Description |
|---------|-------------|
| `agent-os start` | Start the server in background |
| `agent-os stop` | Stop the server |
| `agent-os restart` | Restart the server |
| `agent-os status` | Show status, PID, and URLs |
| `agent-os logs` | Tail server logs |
| `agent-os update` | Pull latest version and rebuild |
| `agent-os enable` | Enable auto-start on boot |
| `agent-os disable` | Disable auto-start |
| `agent-os uninstall` | Remove AgentOS completely |

## Prerequisites

The installer can automatically install these on macOS and Linux:

- **Node.js 20+** - JavaScript runtime
- **npm** - Package manager (comes with Node.js)
- **git** - Version control
- **tmux** - Terminal multiplexer for session management

### AI Coding CLIs

You need at least one AI coding CLI installed. The installer will prompt you to choose:

| CLI | Provider | Install Command |
|-----|----------|-----------------|
| Claude Code | Anthropic | `npm install -g @anthropic-ai/claude-code` |
| Codex | OpenAI | `npm install -g @openai/codex` |
| Aider | Multi-LLM | `pip install aider-chat` |
| Gemini CLI | Google | `npm install -g gemini-cli` |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_OS_HOME` | `~/.agent-os` | Installation directory |
| `AGENT_OS_PORT` | `3011` | Server port |
| `DB_PATH` | `./agent-os.db` | SQLite database path |

### Custom Port

```bash
# Start on a different port
AGENT_OS_PORT=8080 agent-os start

# Or set permanently in your shell config
export AGENT_OS_PORT=8080
```

## Auto-Start on Boot

### macOS (launchd)

```bash
agent-os enable
```

This creates a Launch Agent at `~/Library/LaunchAgents/com.agent-os.plist`.

To disable:
```bash
agent-os disable
```

### Linux (systemd)

```bash
agent-os enable
```

This creates a user service at `~/.config/systemd/user/agent-os.service`.

To disable:
```bash
agent-os disable
```

## Mobile Access with Tailscale

AgentOS is designed for mobile access. The easiest way to access it from your phone is with [Tailscale](https://tailscale.com):

1. **Install Tailscale on your machine:**
   ```bash
   # macOS
   brew install tailscale

   # Linux
   curl -fsSL https://tailscale.com/install.sh | sh
   ```

2. **Start Tailscale and authenticate:**
   ```bash
   sudo tailscale up
   ```

3. **Get your Tailscale IP:**
   ```bash
   tailscale ip -4
   # Example: 100.64.0.1
   ```

4. **Install Tailscale on your phone** (iOS App Store / Google Play)

5. **Sign in with the same account**

6. **Access AgentOS:**
   ```
   http://100.64.0.1:3011
   ```

The `agent-os status` command will show your Tailscale URL if Tailscale is installed.

## Directory Structure

```
~/.agent-os/
├── repo/              # Cloned AgentOS repository
├── agent-os.pid       # PID file when running
├── agent-os.log       # Server logs
└── agent-os.log.old   # Rotated logs (if > 10MB)
```

## Updating

```bash
agent-os update
```

This will:
1. Stop the server if running
2. Pull the latest changes from git
3. Install any new dependencies
4. Rebuild for production
5. Restart the server if it was running

## Troubleshooting

### Server won't start

Check the logs:
```bash
agent-os logs
```

Common issues:
- Port already in use: Change `AGENT_OS_PORT`
- Missing dependencies: Run `agent-os install` again
- Node.js version: Ensure Node.js 20+ is installed

### Can't connect from phone

1. Ensure both devices are on the same Tailscale network
2. Check `agent-os status` for the correct URL
3. Verify the server is running: `agent-os status`
4. Check firewall settings if not using Tailscale

### Build fails

Try a clean reinstall:
```bash
agent-os stop
rm -rf ~/.agent-os/repo/node_modules
rm -rf ~/.agent-os/repo/.next
agent-os install
```

## Uninstalling

```bash
agent-os uninstall
```

This removes:
- The `~/.agent-os` directory
- Auto-start configuration (launchd/systemd)

The `agent-os` CLI script itself is not removed. Delete it manually:
```bash
rm $(which agent-os)
```
