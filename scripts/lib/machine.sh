#!/usr/bin/env bash
# `agent-os machine`: make this Linux box (a WSL distro, a DGX Spark) linkable
# from another AgentOS. Bare, it explains the Connect path (sign in to Connect,
# then `agent-os link`) and changes nothing. With --tailscale it sets up
# sshd for pairing, Tailscale for reaching it and the server kept running. It
# never edits sshd_config or authorized_keys.

# The ssh service's unit name differs by distro (Debian: ssh, others: sshd).
ssh_unit() {
    if systemctl list-unit-files ssh.service 2>/dev/null | grep -q '^ssh.service'; then
        echo ssh
    else
        echo sshd
    fi
}

# MagicDNS name of this node (no trailing dot), empty when Tailscale is off.
tailscale_name() {
    command -v tailscale &> /dev/null || return 0
    tailscale status --json 2>/dev/null \
        | tr ',' '\n' \
        | sed -n 's/.*"DNSName":"\([^"]*\)".*/\1/p' \
        | head -1 | sed 's/\.$//'
}

machine_connect_help() {
    log_info "Recommended: link through AgentOS Connect. It works from any network and needs no ssh or Tailscale (Pro)."
    echo "    1. On this machine:  agent-os connect      (sign in with the code from runagentos.com)"
    echo "    2. On the other one: open Machines and press Link next to this machine"
    echo "       (or run 'agent-os link <name>'). It shows a 6-digit code; type it here:"
    echo "       agent-os link accept <code>"
    echo "    3. This machine then shows a second code. Type it back on the machine you're"
    echo "       linking from (in Machines, or at the 'agent-os link' prompt) to finish."
    echo ""
    log_info "No Connect? Use ssh over Tailscale instead: agent-os machine --tailscale"
}

cmd_machine() {
    local tailscale=0 arg
    for arg in "$@"; do
        case "$arg" in
            --tailscale) tailscale=1 ;;
            *) log_error "Unknown option '$arg'. Usage: agent-os machine [--tailscale]"; exit 1 ;;
        esac
    done
    if [[ "$OS" == "macos" ]]; then
        log_info "A Mac is linked from the other side: on the machine you'll link from, open Machines and add this Mac."
        return 0
    fi
    if [[ ! -d "$REPO_DIR" ]]; then
        log_error "AgentOS is not installed. Run 'agent-os install' first."
        exit 1
    fi
    if [[ "$tailscale" == 0 ]]; then
        machine_connect_help
        return 0
    fi
    if ! has_systemd; then
        if [[ "${WSL:-0}" != 0 ]]; then
            log_error "This needs systemd. Run 'agent-os enable', which offers to turn it on, then try again."
        else
            log_error "This needs systemd to keep sshd and AgentOS running."
        fi
        exit 1
    fi

    if ! command -v sshd &> /dev/null && [[ ! -x "${SSHD_FALLBACK-/usr/sbin/sshd}" ]]; then
        if [[ "$OS" == "debian" ]]; then
            log_info "Installing openssh-server..."
            apt_install openssh-server || { log_error "Couldn't install openssh-server"; exit 1; }
        else
            log_error "Install your distro's OpenSSH server package, then run this again."
            exit 1
        fi
    fi
    if ! sudo systemctl enable --now "$(ssh_unit)"; then
        log_error "Couldn't start sshd"
        exit 1
    fi
    log_success "sshd is running"

    local name
    name=$(tailscale_name)
    if ! command -v tailscale &> /dev/null; then
        log_warn "Tailscale isn't installed here. Install it inside this machine (not just on Windows):"
        echo "    https://tailscale.com/download/linux"
        echo "  then 'sudo tailscale up' and run 'agent-os machine' again."
        exit 1
    elif [[ -z "$name" ]]; then
        log_warn "Tailscale is installed but this machine isn't signed in. Run: sudo tailscale up"
        echo "  then run 'agent-os machine' again."
        exit 1
    fi

    cmd_enable
    # The server follows tailnet address changes on its own; it only needs to be up.
    is_running || cmd_start

    local user="${USER:-$(id -un)}" ip
    ip=$(get_tailscale_ip)
    echo ""
    log_success "Ready to link. On the machine you'll link from (any AgentOS: a Mac, Linux or WSL), open Machines → Add:"
    echo "    ssh host   $name"
    echo "    user       $user"
    echo "    url        http://$name:$PORT"
    echo ""
    echo "  If that machine can't ssh in yet, run this on it first:"
    echo "    ssh-copy-id $user@$name"
    if [[ -n "$ip" ]] && ! curl -sf "http://$ip:$PORT/api/health" > /dev/null 2>&1; then
        log_warn "The server isn't answering on the tailnet address $ip yet. Check 'agent-os logs'."
    fi
}
