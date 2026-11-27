#!/usr/bin/env bash
# What to run next, and the end of `agent-os install`: start AgentOS, say where
# it is, open it. Also the guard that turns an unexpected failure during
# install into a message with a cause and a command, never a bare shell error.
# Stays bash 3.2 clean (macOS): no associative arrays, mapfile or ${x,,}.

ISSUES_URL="https://github.com/saadnvd1/agent-os/issues"

# missing | built | running
install_state() {
    if [[ ! -f "$REPO_DIR/.next/BUILD_ID" ]]; then
        echo missing
    elif is_running || [[ -n "$(port_holder)" ]]; then
        echo running
    else
        echo built
    fi
}

# "name (PID n)" of whatever listens on our port, or nothing.
port_holder() {
    command -v lsof &> /dev/null || return 0
    local pid name
    pid=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2> /dev/null | head -1 || true)
    [[ -n "$pid" ]] || return 0
    name=$(ps -p "$pid" -o comm= 2> /dev/null | sed 's|.*/||' || true)
    echo "${name:-a program} (PID $pid)"
}

# The agent-os command to show: bare when it's on PATH, else the full path.
agent_os_cmd() {
    if command -v agent-os &> /dev/null; then
        echo agent-os
    else
        echo "$HOME/.local/bin/agent-os"
    fi
}

# One obvious next command, from where the install is.
print_next_step() {
    echo ""
    case "$(install_state)" in
        missing)
            echo -e "${BOLD}Start here:${NC} agent-os install"
            echo "  Checks tmux and git, builds the app, starts it and opens it in your browser."
            ;;
        built)
            echo -e "${BOLD}Next:${NC} agent-os start   (then open http://localhost:$PORT)"
            echo "  agent-os setup keeps it running after a restart and adds your phone."
            ;;
        running)
            echo -e "${BOLD}AgentOS is running:${NC} http://localhost:$PORT"
            ;;
    esac
}

# Commands that need the built app say so instead of failing inside it.
require_installed() {
    if [[ ! -f "$REPO_DIR/.next/BUILD_ID" ]]; then
        log_error "AgentOS isn't installed yet (nothing built in $REPO_DIR)."
        log_error "Run: agent-os install"
        exit 1
    fi
}

# Is there a browser to open? macOS and WSL always; Linux only on a desktop.
can_open_browser() {
    [[ "${AGENTOS_NO_OPEN:-}" == 1 ]] && return 1
    [[ "${OS:-}" == macos || "${WSL:-0}" != 0 || -n "${DISPLAY:-}" || -n "${WAYLAND_DISPLAY:-}" ]]
}

# Wait for AgentOS to answer on its port.
wait_for_server() {
    local i
    for ((i = 0; i < ${1:-30}; i++)); do
        if curl -fs --max-time 2 "http://127.0.0.1:$PORT/api/health" > /dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done
    return 1
}

# The end of `agent-os install`: running, where to go, and one next command.
install_finish() {
    local open_browser="${1:-true}" url="http://localhost:$PORT" holder
    if ! is_running; then
        holder=$(port_holder)
        if [[ -n "$holder" ]]; then
            log_warn "Port $PORT is held by $holder, so AgentOS wasn't started."
            log_warn "Free it, or pick another port: AGENT_OS_PORT=3012 agent-os start"
            return 0
        fi
    fi
    cmd_start || {
        log_error "AgentOS is built but didn't start. Run: agent-os logs"
        return 1
    }
    if ! wait_for_server 30; then
        log_error "AgentOS didn't answer on port $PORT within 30 seconds."
        log_error "See what it said: agent-os logs   (or: agent-os check)"
        return 1
    fi
    echo ""
    log_success "AgentOS is running: $url"
    if [[ "$open_browser" == true ]] && is_interactive && can_open_browser; then
        open_url "$url" > /dev/null 2>&1 || echo "Open it in your browser: $url"
    else
        echo "Open it in your browser: $url"
    fi
    echo ""
    echo "To keep it running after a restart and use it from your phone: $(agent_os_cmd) setup"
}

# --- the guard ----------------------------------------------------------

AOS_GUARD_FAIL=""
AOS_EXPLAINED=0

aos_note_failure() { AOS_GUARD_FAIL="$1 (line $2)"; }

aos_guard_exit() {
    local code=$?
    trap - EXIT ERR
    if [[ "$code" != 0 && "$AOS_EXPLAINED" == 0 && -n "$AOS_GUARD_FAIL" ]]; then
        echo ""
        log_error "agent-os stopped on an unexpected error: $AOS_GUARD_FAIL (exit $code)."
        log_error "Run the same command again. If it fails the same way, report it with the output above: $ISSUES_URL"
    fi
    exit "$code"
}

guard_begin() {
    set -E
    trap 'aos_note_failure "$BASH_COMMAND" "$LINENO"' ERR
    trap aos_guard_exit EXIT
}

# Run a step; when it fails say what failed and the command that fixes it.
run_step() {
    local what="$1" fix="$2"
    shift 2
    if ! "$@"; then
        AOS_EXPLAINED=1
        log_error "$what failed."
        log_error "$fix"
        exit 1
    fi
}
