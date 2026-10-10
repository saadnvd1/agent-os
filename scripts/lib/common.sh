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

# WSL version: 2, 1, or 0 when not under WSL. The same test as lib/wsl.ts:
# the kernel release names Microsoft, and WSL_DISTRO_NAME is the fallback
# (it isn't set under systemd or sudo). AGENTOS_OSRELEASE_FILE is for tests.
detect_wsl() {
    if [[ "$(uname -s)" != Linux* ]]; then
        echo 0
        return
    fi
    local rel
    rel=$(tr '[:upper:]' '[:lower:]' < "${AGENTOS_OSRELEASE_FILE:-/proc/sys/kernel/osrelease}" 2>/dev/null || true)
    if [[ "$rel" == *microsoft* ]]; then
        if [[ "$rel" == *wsl2* || "$rel" == *microsoft-standard* ]]; then
            echo 2
        else
            echo 1
        fi
    elif [[ -n "${WSL_DISTRO_NAME:-}" ]]; then
        echo 2
    else
        echo 0
    fi
}

# systemd is PID 1 (under WSL only with systemd=true in /etc/wsl.conf).
has_systemd() {
    [[ "$(ps -p 1 -o comm= 2>/dev/null)" == "systemd" ]]
}

# Open a URL in the user's browser; under WSL that's the Windows one.
open_url() {
    local url="$1"
    if [[ "$OS" == "macos" ]]; then
        open "$url"
    elif [[ "${WSL:-0}" != 0 ]] && command -v wslview &> /dev/null; then
        wslview "$url"
    elif [[ "${WSL:-0}" != 0 ]] && command -v explorer.exe &> /dev/null; then
        # explorer.exe exits 1 even when it opened the page.
        explorer.exe "$url" || true
    elif command -v xdg-open &> /dev/null; then
        xdg-open "$url"
    else
        log_warn "Could not detect a browser. Open manually: $url"
    fi
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
