# AgentOS

A mobile-first web UI for managing AI coding sessions.

[![Discord](https://img.shields.io/discord/1379529488498049024?color=5865F2&logo=discord&logoColor=white)](https://discord.gg/cSjutkCGAh)

https://github.com/user-attachments/assets/0e2e66f7-037e-4739-99ec-608d1840df0a

![AgentOS Screenshot](screenshot-v2.png)

## Installation

```bash
# One-liner
curl -fsSL https://raw.githubusercontent.com/saadnvd1/agent-os/main/scripts/install.sh | bash

# Then run
agent-os start
```

> **Don't want to self-host?** Try [AgentOS Cloud](https://runagentos.com) - pre-configured cloud VMs for AI coding.

### Manual Install

```bash
git clone https://github.com/saadnvd1/agent-os
cd agent-os
npm install
npm run dev  # http://localhost:3011
```

### Prerequisites

- Node.js 20+
- tmux
- At least one AI CLI: [Claude Code](https://github.com/anthropics/claude-code), [Codex](https://github.com/openai/codex), [OpenCode](https://github.com/anomalyco/opencode), [Gemini CLI](https://github.com/google-gemini/gemini-cli), [Aider](https://aider.chat/), or [Cursor CLI](https://cursor.com/cli)

## Supported Agents

| Agent       | Resume | Fork | Auto-Approve                     |
| ----------- | ------ | ---- | -------------------------------- |
| Claude Code | ✅     | ✅   | `--dangerously-skip-permissions` |
| Codex       | ❌     | ❌   | `--approval-mode full-auto`      |
| OpenCode    | ❌     | ❌   | Config file                      |
| Gemini CLI  | ❌     | ❌   | `--yolomode`                     |
| Aider       | ❌     | ❌   | `--yes`                          |
| Cursor CLI  | ❌     | ❌   | N/A                              |

## Features

- **Mobile-first** - Full functionality from your phone, not a dumbed-down responsive view
- **Multi-pane layout** - Run up to 4 sessions side-by-side
- **Git integration** - Status, diffs, commits, PRs from the UI
- **Git worktrees** - Isolated branches with auto-setup
- **Dev servers** - Start/stop Node.js and Docker servers
- **Session orchestration** - Conductor/worker model via MCP

## CLI Commands

```bash
agent-os run       # Start and open browser
agent-os start     # Start in background
agent-os stop      # Stop server
agent-os status    # Show URLs
agent-os logs      # Tail logs
agent-os update    # Update to latest
```

## Mobile Access

Use [Tailscale](https://tailscale.com) for secure access from your phone:

1. Install Tailscale on your dev machine and phone
2. Sign in with the same account
3. Access `http://100.x.x.x:3011` from your phone

## Documentation

For configuration and advanced usage, see the [docs](https://www.runagentos.com/docs).

## License

Business Source License 1.1 (BUSL-1.1) - converts to MIT on January 1, 2029.

See [LICENSE](LICENSE) for full terms.
