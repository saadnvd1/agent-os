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

# Check Claude CLI
if ! command -v claude &> /dev/null; then
    echo "Error: Claude Code CLI is not installed"
    echo "Install: npm install -g @anthropic-ai/claude-code"
    exit 1
fi
echo "Claude CLI: installed"

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
