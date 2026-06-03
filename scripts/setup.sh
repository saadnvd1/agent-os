#!/bin/bash
set -e

echo "Agent-OS Setup"
echo "=============="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed"
    echo "Install Node.js 20+ from https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "Error: Node.js 20+ required (found v$NODE_VERSION)"
    exit 1
fi
echo "Node.js: $(node -v)"

# Check tmux
if ! command -v tmux &> /dev/null; then
    echo "Error: tmux is not installed"
    echo "Install: brew install tmux (macOS) or apt install tmux (Linux)"
    exit 1
fi
echo "tmux: $(tmux -V)"

# Check AI coding CLI
AI_CLI_FOUND=""
for cli in claude codex opencode kilo gemini aider cursor-agent amp pi omp; do
    if command -v "$cli" &> /dev/null; then
        AI_CLI_FOUND="$AI_CLI_FOUND $cli"
    fi
done

if [ -z "$AI_CLI_FOUND" ]; then
    echo "Error: no supported AI coding CLI is installed"
    echo "Install one of: Claude Code, Codex, OpenCode, Kilo Code CLI, Gemini CLI, Aider, Cursor CLI, Amp, Pi, or Oh My Pi"
    exit 1
fi
echo "AI CLI(s):$AI_CLI_FOUND"

# Check jq
if ! command -v jq &> /dev/null; then
    echo "Warning: jq is not installed (optional, for session ID parsing)"
    echo "Install: brew install jq (macOS) or apt install jq (Linux)"
fi

# Copy .env if needed
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        cp .env.example .env
        echo ""
        echo "Created .env from .env.example"
    fi
fi

# Install dependencies
echo ""
echo "Installing dependencies..."
npm install

echo ""
echo "Setup complete!"
echo "Run 'npm run dev' to start the development server"
