#!/usr/bin/env bash
#
# AgentOS Installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/saadnvd1/agent-os/main/scripts/install.sh | bash
#
# This script downloads the agent-os CLI and runs install.
# The CLI handles all dependency installation interactively.

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

log_info() { echo -e "${BLUE}==>${NC} $1"; }
log_success() { echo -e "${GREEN}==>${NC} $1"; }
log_error() { echo -e "${RED}==>${NC} $1"; }

REPO_URL="https://raw.githubusercontent.com/saadnvd1/agent-os/main"

echo ""
echo -e "${BOLD}AgentOS Installer${NC}"
echo ""

# Determine install location
if [[ -w /usr/local/bin ]]; then
    BIN_DIR="/usr/local/bin"
else
    BIN_DIR="$HOME/.local/bin"
    mkdir -p "$BIN_DIR"
fi

# Download the CLI script
log_info "Downloading agent-os CLI to $BIN_DIR..."

if command -v curl &> /dev/null; then
    curl -fsSL "$REPO_URL/scripts/agent-os" -o "$BIN_DIR/agent-os"
elif command -v wget &> /dev/null; then
    wget -qO "$BIN_DIR/agent-os" "$REPO_URL/scripts/agent-os"
else
    log_error "curl or wget is required"
    exit 1
fi

chmod +x "$BIN_DIR/agent-os"
log_success "CLI installed to $BIN_DIR/agent-os"

# Check if BIN_DIR is in PATH
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo ""
    log_info "$BIN_DIR is not in your PATH"

    # Detect shell config file
    shell_name=$(basename "$SHELL")
    case "$shell_name" in
        zsh)  rc_file="$HOME/.zshrc" ;;
        bash) rc_file="$HOME/.bashrc" ;;
        *)    rc_file="$HOME/.profile" ;;
    esac

    echo ""
    echo "Add this to your $rc_file:"
    echo ""
    echo "  export PATH=\"$BIN_DIR:\$PATH\""
    echo ""

    # Export for current session
    export PATH="$BIN_DIR:$PATH"
fi

# Run install
echo ""
"$BIN_DIR/agent-os" install

echo ""
echo -e "${BOLD}Setup complete!${NC}"
echo ""
echo "Commands:"
echo "  agent-os start     Start the server"
echo "  agent-os status    Show status and URLs"
echo "  agent-os enable    Auto-start on boot"
echo "  agent-os help      Show all commands"
echo ""
