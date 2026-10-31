#!/usr/bin/env bash
# agent-os setup: install, keep it running, choose how other devices reach
# this machine, check that they can, then add a phone. Every step checks first,
# so running it again only does what's missing. It never touches the firewall,
# Tailscale, the router or DNS: it says what to do instead.

# Runs a TypeScript entry point from the checkout this script belongs to.
aos_tsx() { (cd "$(dirname "$SCRIPT_DIR")" && npx tsx "$@"); }

SETUP_VIA=""
SETUP_YES=0
SETUP_SERVICE=1
SETUP_PAIR=1

setup_title() { echo ""; echo -e "${BOLD}$1${NC}"; }
setup_ok() { echo -e "  ${GREEN}✓${NC} $1"; }
setup_done() { echo -e "  ${GREEN}✓${NC} $1 (already done)"; }
setup_note() { echo "  $1"; }

# A yes/no question. Under --yes it takes $3 (or the default) without asking.
setup_yn() {
    if [[ "$SETUP_YES" == 1 ]] || ! is_interactive; then
        [[ "${3:-$2}" == y ]]
        return
    fi
    prompt_yn "  $1" "$2"
}

setup_api() {
    curl -fsS --max-time "${2:-5}" "http://127.0.0.1:$PORT$1" 2> /dev/null
}

# One field from JSON on stdin, by dotted path; empty when missing.
json_field() {
    node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  let v;
  try { v = process.argv[1].split(".").reduce((o, k) => o?.[k], JSON.parse(s)); } catch {}
  process.stdout.write(v == null ? "" : String(v));
});' "$1"
}

# up | not-agentos | down: what answers on AgentOS's port.
setup_server_state() {
    local health
    if health=$(setup_api /api/health 3) && [[ "$(echo "$health" | json_field startedAt)" != "" ]]; then
        echo up
    elif curl -s --max-time 3 -o /dev/null "http://127.0.0.1:$PORT/" 2> /dev/null; then
        echo not-agentos
    else
        echo down
    fi
}

# Whether the server on the port is ours to manage: our pid file, our launchd
# agent or our systemd unit. Otherwise something else runs it.
setup_server_is_ours() {
    is_running && return 0
    [[ "${OS:-}" == "macos" ]] && launchd_loaded && return 0
    systemd_unit_active
}

setup_wait_up() {
    local i
    for ((i = 0; i < ${1:-30}; i++)); do
        [[ "$(setup_server_state)" == up ]] && return 0
        sleep 1
    done
    return 1
}

setup_install() {
    setup_title "1. Install"
    if [[ -f "$REPO_DIR/.next/BUILD_ID" ]]; then
        setup_done "AgentOS is installed"
    else
        cmd_install
    fi
}

setup_service() {
    setup_title "2. Keep it running"
    local server
    server=$(setup_server_state)
    if [[ "$server" == not-agentos ]]; then
        log_error "Another program holds port $PORT."
        aos_tsx lib/reach/cli.ts "$PORT"
        exit 2
    fi
    if [[ "$server" == up ]] && ! setup_server_is_ours; then
        setup_ok "AgentOS is already running, started some other way: leaving it as it is"
        return 0
    fi
    if [[ "$SETUP_SERVICE" == 1 && "$(service_kind)" != none ]]; then
        local path
        path=$(service_path)
        case "$(service_file_state)" in
            same)
                setup_done "Starts at login and restarts after a crash"
                ;;
            absent)
                if setup_yn "Start AgentOS at login and keep it running?" y; then
                    cmd_enable
                fi
                ;;
            older)
                setup_note "The service AgentOS installed before doesn't restart it after a crash."
                if setup_yn "Update it?" y n; then
                    cmd_enable
                else
                    setup_ok "Kept the current service file"
                fi
                ;;
            changed)
                setup_note "$path differs from what AgentOS would write (edited by you?)."
                if setup_yn "Replace it with AgentOS's own?" n n; then
                    cmd_enable
                else
                    setup_ok "Kept yours"
                fi
                ;;
        esac
    fi
    if [[ "$(setup_server_state)" == up ]]; then
        setup_ok "AgentOS is running on port $PORT"
        return 0
    fi
    cmd_start
    if setup_wait_up 30; then
        setup_ok "AgentOS is running on port $PORT"
    else
        log_error "AgentOS didn't answer within 30 seconds."
        aos_tsx lib/reach/cli.ts "$PORT"
        exit 2
    fi
}

# The route already set up, or Connect.
setup_default_via() {
    local net="$1"
    if [[ -n "$(echo "$net" | json_field connect.hostname)" || "$(echo "$net" | json_field connect.enrolled)" == true ]]; then
        echo connect
    elif [[ "$(echo "$net" | json_field tailscale.state)" == running ]]; then
        echo tailscale
    elif [[ "$(echo "$net" | json_field lan.on)" == true ]]; then
        echo lan
    else
        echo connect
    fi
}

setup_choose_via() {
    local net="$1" default n
    default=$(setup_default_via "$net")
    if [[ -n "$SETUP_VIA" ]]; then
        return 0
    fi
    if [[ "$SETUP_YES" == 1 ]] || ! is_interactive; then
        SETUP_VIA="$default"
        return 0
    fi
    local -a vias=(connect tailscale lan)
    local d=1
    [[ "$default" == tailscale ]] && d=2
    [[ "$default" == lan ]] && d=3
    setup_note "1) Connect: works from any network, nothing to open on your router. Free for one machine."
    setup_note "2) Tailscale: your own private network, if you already use it."
    setup_note "3) Same Wi-Fi only."
    read -p "  Choose [$d]: " -r n
    n="${n:-$d}"
    if [[ ! "$n" =~ ^[123]$ ]]; then
        log_warn "Not one of 1, 2 or 3: using $d"
        n="$d"
    fi
    SETUP_VIA="${vias[$((n - 1))]}"
}

setup_connect() {
    local net="$1"
    if [[ -z "$(echo "$net" | json_field connect.hostname)" && "$(echo "$net" | json_field connect.enrolled)" != true ]]; then
        if [[ "$SETUP_YES" == 1 ]] || ! is_interactive; then
            setup_note "Connect needs a link code: run 'agent-os connect' and paste it."
            return 0
        fi
        setup_note "Connect needs a free account and a link code."
        if setup_yn "Open the sign-up page?" y; then
            open_url "https://runagentos.com/sign-in?mode=sign-up" || true
        fi
        # The connect command asks for the code itself: it never passes
        # through this script.
        aos_tsx lib/connect/cli.ts || return 0
    elif [[ "$(echo "$net" | json_field connect.state)" == off ]]; then
        aos_tsx lib/connect/cli.ts --on || return 0
    else
        setup_done "Connect is linked"
    fi
    local i state
    printf "  Connecting"
    for ((i = 0; i < 60; i++)); do
        state=$(setup_api /api/devices/network | json_field connect.state)
        [[ "$state" == up ]] && break
        [[ "$state" == denied || "$state" == refused ]] && break
        printf "."
        sleep 1
    done
    echo ""
}

setup_lan() {
    local net="$1"
    if [[ "$(echo "$net" | json_field lan.on)" == true ]]; then
        setup_done "Devices on this Wi-Fi can connect"
        return 0
    fi
    setup_note "Use this on networks you trust: Wi-Fi traffic to AgentOS isn't encrypted."
    if setup_yn "Allow paired devices on this Wi-Fi?" y; then
        if curl -fsS --max-time 5 -X PUT -H "Content-Type: application/json" \
            -d '{"lan":true}' "http://127.0.0.1:$PORT/api/devices/network" > /dev/null 2>&1; then
            setup_ok "Devices on this Wi-Fi can connect"
        else
            log_warn "Couldn't turn it on: do it in Settings → Devices & access"
        fi
    fi
}

setup_route() {
    setup_title "3. How other devices reach this machine"
    local net
    net=$(setup_api /api/devices/network) || net="{}"
    setup_choose_via "$net"
    case "$SETUP_VIA" in
        connect) setup_connect "$net" ;;
        tailscale) setup_note "AgentOS never changes Tailscale: the check below says what it needs." ;;
        lan) setup_lan "$net" ;;
    esac
}

setup_check() {
    setup_title "4. Check"
    local tries=0 code
    while :; do
        code=0
        aos_tsx lib/reach/cli.ts "$PORT" --via "$SETUP_VIA" || code=$?
        [[ "$code" -lt 2 ]] && return 0
        tries=$((tries + 1))
        if [[ "$tries" -ge 3 ]] || ! setup_yn "Fixed it? Check again?" y n; then
            echo ""
            echo "  Run 'agent-os setup' again once it's fixed; finished steps are skipped."
            return 1
        fi
    done
}

setup_phone() {
    setup_title "5. Your phone"
    if [[ "$SETUP_PAIR" == 1 ]] && setup_yn "Add your phone now?" y n; then
        node "$SCRIPT_DIR/pair.mjs" "$PORT"
    else
        setup_note "Add one any time: agent-os pair"
    fi
}

cmd_setup() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --via)
                if [[ $# -lt 2 ]]; then
                    log_error "--via takes connect, tailscale or lan"
                    exit 2
                fi
                SETUP_VIA="$2"
                shift
                ;;
            --via=*) SETUP_VIA="${1#--via=}" ;;
            --yes | -y) SETUP_YES=1 ;;
            --no-service) SETUP_SERVICE=0 ;;
            --no-pair) SETUP_PAIR=0 ;;
            *)
                log_error "Unknown option: $1"
                echo "Usage: agent-os setup [--via connect|tailscale|lan] [--yes] [--no-service] [--no-pair]"
                exit 2
                ;;
        esac
        shift
    done
    if [[ -n "$SETUP_VIA" && ! "$SETUP_VIA" =~ ^(connect|tailscale|lan)$ ]]; then
        log_error "--via takes connect, tailscale or lan"
        exit 2
    fi

    echo ""
    echo -e "${BOLD}AgentOS setup${NC} (safe to run again: finished steps are skipped)"
    setup_install
    setup_service
    setup_route
    local ok=0
    setup_check || ok=1
    [[ "$ok" == 0 ]] && setup_phone
    echo ""
    echo "Check again any time: agent-os check"
    return "$ok"
}
