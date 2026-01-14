#!/usr/bin/env bash
#
# AgentOS Installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/saadnvd1/agent-os/main/scripts/install.sh | bash
#

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

REPO_URL="https://github.com/saadnvd1/agent-os.git"
INSTALL_DIR="$HOME/.agent-os/repo"

echo ""
echo -e "${BOLD}AgentOS Installer${NC}"
echo ""

# Check for git
if ! command -v git &> /dev/null; then
    log_error "git is required. Please install git first."
    exit 1
fi

# Clone or update repo
if [[ -d "$INSTALL_DIR" ]]; then
    log_info "Updating existing installation..."
    cd "$INSTALL_DIR"
    git pull --ff-only
else
    log_info "Downloading AgentOS..."
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Run the install command
exec "$INSTALL_DIR/scripts/agent-os" install
