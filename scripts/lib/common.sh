#!/usr/bin/env bash
# Common utilities for agent-os scripts

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Logging
log_info() { echo -e "${BLUE}==>${NC} $1"; }
log_success() { echo -e "${GREEN}==>${NC} $1"; }
log_warn() { echo -e "${YELLOW}==>${NC} $1"; }
log_error() { echo -e "${RED}==>${NC} $1"; }

# OS Detection
detect_os() {
    case "$(uname -s)" in
        Darwin*)
            echo "macos"
            ;;
        Linux*)
            if [[ -f /etc/debian_version ]]; then
                echo "debian"
            elif [[ -f /etc/redhat-release ]]; then
                echo "redhat"
            else
                echo "linux"
            fi
            ;;
        *)
            echo "unknown"
            ;;
    esac
}

# Check if running interactively
is_interactive() {
    [[ -t 0 ]] && [[ -t 1 ]]
}

# Prompt for yes/no
prompt_yn() {
    local prompt="$1"
    local default="${2:-y}"

    if ! is_interactive; then
        [[ "$default" == "y" ]]
        return
    fi

    local yn_prompt
    if [[ "$default" == "y" ]]; then
        yn_prompt="[Y/n]"
    else
        yn_prompt="[y/N]"
    fi

    read -p "$prompt $yn_prompt " -r response
    response="${response:-$default}"

    [[ "$response" =~ ^[Yy] ]]
}

# Process management helpers
get_pid() {
    local pid_file="$AGENT_OS_HOME/agent-os.pid"
    if [[ -f "$pid_file" ]]; then
        local pid
        pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            echo "$pid"
            return 0
        fi
    fi
    return 1
}

is_running() {
    get_pid &>/dev/null
}

# Get Tailscale IP if available
get_tailscale_ip() {
    if command -v tailscale &> /dev/null; then
        tailscale ip -4 2>/dev/null | head -1
    fi
}
