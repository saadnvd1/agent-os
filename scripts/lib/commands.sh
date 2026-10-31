#!/usr/bin/env bash
# Command implementations for agent-os

# The background service (launchd/systemd) the start/stop commands go through.
source "${BASH_SOURCE[0]%/*}/service.sh"

cmd_install() {
    local use_local=false
    [[ "${1:-}" == "--local" ]] && use_local=true

    log_info "Installing AgentOS..."
    echo ""

    # Check and install prerequisites
    check_and_install_prerequisites

    # Prompt for AI CLI installation
    prompt_ai_cli_install

    # Create directory structure
    mkdir -p "$AGENT_OS_HOME"

    # Clone, copy local, or update repo
    if [[ -d "$REPO_DIR" ]]; then
        if [[ "$use_local" == true ]]; then
            log_info "Updating from local source..."
            rsync -a --delete --exclude='.git' --exclude='node_modules' --exclude='.next' --exclude='*.db*' "$LOCAL_REPO/" "$REPO_DIR/"
        else
            log_info "Repository already exists, pulling latest..."
            cd "$REPO_DIR"
            git pull --ff-only
        fi
        cd "$REPO_DIR"
    else
        if [[ "$use_local" == true ]]; then
            log_info "Copying from local source..."
            rsync -a --exclude='.git' --exclude='node_modules' --exclude='.next' --exclude='*.db*' "$LOCAL_REPO/" "$REPO_DIR/"
            cd "$REPO_DIR"
            git init
        else
            log_info "Cloning repository..."
            git clone "$REPO_URL" "$REPO_DIR"
            cd "$REPO_DIR"
        fi
    fi

    # Install dependencies
    log_info "Installing dependencies..."
    scripts/install-deps

    # Build for production
    log_info "Building for production..."
    npm run build

    # Create CLI symlink (prefer ~/.local/bin to avoid sudo)
    log_info "Adding agent-os to PATH..."
    local bin_dir="$HOME/.local/bin"
    local needs_path_update=false

    mkdir -p "$bin_dir"
    ln -sf "$REPO_DIR/scripts/agent-os" "$bin_dir/agent-os"
    "$REPO_DIR/scripts/sync-cli-links" create

    # Check if ~/.local/bin is in PATH
    if [[ ":$PATH:" != *":$bin_dir:"* ]]; then
        needs_path_update=true
        # Add to shell profile
        local shell_profile=""
        if [[ -f "$HOME/.zshrc" ]]; then
            shell_profile="$HOME/.zshrc"
        elif [[ -f "$HOME/.bashrc" ]]; then
            shell_profile="$HOME/.bashrc"
        elif [[ -f "$HOME/.bash_profile" ]]; then
            shell_profile="$HOME/.bash_profile"
        fi

        if [[ -n "$shell_profile" ]]; then
            if ! grep -q 'export PATH="$HOME/.local/bin:$PATH"' "$shell_profile" 2>/dev/null; then
                echo '' >> "$shell_profile"
                echo '# Added by AgentOS' >> "$shell_profile"
                echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$shell_profile"
            fi
        fi
    fi

    echo ""
    log_success "AgentOS installed successfully!"
    echo ""

    if [[ "$needs_path_update" == true ]]; then
        echo "Note: ~/.local/bin was added to your PATH."
        echo "Run 'source ~/.zshrc' or restart your terminal, then:"
        echo ""
    fi

    echo "Next steps:"
    echo "  agent-os setup     Start it, keep it running, and reach it from your phone"
    echo "  agent-os check     Can other devices reach this machine? (names the cause if not)"
    echo "  agent-os status    Show URLs"
    wsl_next_steps
}

# What's different under WSL, after an install.
wsl_next_steps() {
    [[ "${WSL:-0}" == 0 ]] && return 0
    echo ""
    echo "Windows (WSL):"
    if [[ "$WSL" == 1 ]]; then
        echo "  This is WSL 1, which AgentOS doesn't support. From Windows: wsl --set-version <distro> 2"
    fi
    echo "  Open http://localhost:$PORT in your Windows browser. Use localhost, not"
    echo "  127.0.0.1: passkeys (Windows Hello) only work on localhost or https."
    if has_systemd; then
        echo "  agent-os enable    Starts it with your WSL distro (systemd is on)."
    else
        echo "  agent-os enable needs systemd. Add this to /etc/wsl.conf, then run"
        echo "  'wsl --shutdown' from Windows and reopen your terminal:"
        echo "      [boot]"
        echo "      systemd=true"
    fi
    echo "  Keep projects in your Linux home (~), not /mnt/c: git, npm and file"
    echo "  watching are slow on the Windows drive, and changes made from Windows"
    echo "  aren't noticed."
}

# True when the systemd user unit `agent-os enable` writes is running
# AgentOS: then start, stop and restart go through systemd, or a restart
# would leave a second server outside the unit for systemd to fight.
systemd_unit_active() {
    has_systemd && systemctl --user is-active --quiet agent-os 2>/dev/null
}

cmd_start() {
    if [[ "${OS:-}" == "macos" ]] && ! is_running && launchd_keeps_alive; then
        if launchd_loaded; then
            launchd_kickstart && log_success "AgentOS started (launchd)" && return 0
        elif launchd_bootstrap; then
            log_success "AgentOS started (launchd)"
            return 0
        fi
        # No desktop session (ssh): run it by hand this time.
        launchd_no_gui_session
    fi
    if ! is_running && has_systemd &&
        systemctl --user is-enabled --quiet agent-os 2>/dev/null; then
        systemctl --user start agent-os
        log_success "AgentOS started (systemd)"
        return 0
    fi
    if is_running; then
        local pid
        pid=$(get_pid)
        log_warn "AgentOS is already running (PID: $pid)"
        return 0
    fi

    if [[ ! -d "$REPO_DIR" ]]; then
        log_error "AgentOS is not installed. Run 'agent-os install' first."
        exit 1
    fi

    log_info "Starting AgentOS..."

    cd "$REPO_DIR"

    # Rotate log if too big (> 10MB)
    if [[ -f "$LOG_FILE" ]]; then
        local size
        size=$(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)
        if [[ "$size" -gt 10485760 ]]; then
            mv "$LOG_FILE" "$LOG_FILE.old"
        fi
    fi

    # Start server in background
    nohup npm start >> "$LOG_FILE" 2>&1 &
    local pid=$!
    echo "$pid" > "$PID_FILE"

    # Wait and verify
    sleep 2
    if ! ps -p "$pid" &> /dev/null; then
        log_error "Failed to start AgentOS. Check logs: agent-os logs"
        rm -f "$PID_FILE"
        exit 1
    fi

    log_success "AgentOS started (PID: $pid)"
    echo ""
    echo "  Local:     http://localhost:$PORT"

    local ts_ip
    ts_ip=$(get_tailscale_ip)
    if [[ -n "$ts_ip" ]]; then
        echo "  Tailscale: http://$ts_ip:$PORT"
    fi
    echo ""
    echo "Run 'agent-os logs' to view logs"
}

cmd_stop() {
    # A kill would just be restarted: launchd stops it, until the next login
    # or 'agent-os start'.
    if [[ "${OS:-}" == "macos" ]] && launchd_loaded && launchd_keeps_alive; then
        log_info "Stopping AgentOS (launchd)..."
        launchd_bootout
        rm -f "$PID_FILE"
        log_success "AgentOS stopped"
        return 0
    fi
    if systemd_unit_active; then
        log_info "Stopping AgentOS (systemd)..."
        systemctl --user stop agent-os
        rm -f "$PID_FILE"
        log_success "AgentOS stopped"
        return 0
    fi
    if ! is_running; then
        log_warn "AgentOS is not running"
        return 0
    fi

    local pid
    pid=$(get_pid)
    log_info "Stopping AgentOS (PID: $pid)..."

    kill "$pid" 2>/dev/null || true

    # Wait for graceful shutdown with progress
    local count=0
    printf "    Waiting for shutdown"
    while ps -p "$pid" &> /dev/null && [[ $count -lt 10 ]]; do
        printf "."
        sleep 1
        count=$((count + 1))
    done
    echo ""

    # Force kill if still running
    if ps -p "$pid" &> /dev/null; then
        log_warn "Force killing..."
        kill -9 "$pid" 2>/dev/null || true
        sleep 1
    fi

    rm -f "$PID_FILE"
    log_success "AgentOS stopped"
}

cmd_restart() {
    if [[ "${OS:-}" == "macos" ]] && launchd_loaded && launchd_keeps_alive; then
        launchd_restart
        log_success "AgentOS restarted (launchd)"
        return 0
    fi
    if systemd_unit_active; then
        systemctl --user restart agent-os
        log_success "AgentOS restarted (systemd)"
        return 0
    fi
    cmd_stop
    sleep 1
    cmd_start
}

cmd_run() {
    # Start if not running
    if ! is_running; then
        cmd_start
    fi

    # Wait a moment for server to be ready
    sleep 1

    local url="http://localhost:$PORT"
    log_info "Opening $url..."

    open_url "$url"
}

cmd_status() {
    echo ""
    if is_running; then
        local pid
        pid=$(get_pid)
        echo -e "  Status:    ${GREEN}Running${NC} (PID: $pid)"
        echo "  Port:      $PORT"
        echo "  Local:     http://localhost:$PORT"

        local ts_ip
        ts_ip=$(get_tailscale_ip)
        if [[ -n "$ts_ip" ]]; then
            echo "  Tailscale: http://$ts_ip:$PORT"
        fi

        echo "  Logs:      $LOG_FILE"
        echo "  Install:   $REPO_DIR"
    else
        echo -e "  Status:    ${RED}Stopped${NC}"

        if [[ -d "$REPO_DIR" ]]; then
            echo "  Install:   $REPO_DIR"
            echo ""
            echo "  Run 'agent-os start' to start the server"
        else
            echo "  Install:   Not installed"
            echo ""
            echo "  Run 'agent-os install' to install"
        fi
    fi
    echo ""
}

cmd_logs() {
    if [[ ! -f "$LOG_FILE" ]]; then
        log_warn "No log file found"
        exit 1
    fi

    tail -f "$LOG_FILE"
}

cmd_update() {
    if [[ ! -d "$REPO_DIR" ]]; then
        log_error "AgentOS is not installed. Run 'agent-os install' first."
        exit 1
    fi

    local was_running=false
    if is_running; then
        was_running=true
        cmd_stop
    fi

    log_info "Updating AgentOS..."

    cd "$REPO_DIR"

    # Fetch and check
    git fetch
    local local_hash remote_hash
    local_hash=$(git rev-parse HEAD)
    remote_hash=$(git rev-parse @{u})

    if [[ "$local_hash" == "$remote_hash" ]]; then
        log_success "Already up to date"
    else
        log_info "Pulling latest changes..."
        git pull --ff-only

        log_info "Installing dependencies..."
        scripts/install-deps

        log_info "Rebuilding..."
        npm run build

        log_success "Update complete!"
    fi

    scripts/sync-cli-links || log_warn "Could not sync the CLI links"

    if [[ "$was_running" == true ]]; then
        cmd_start
    fi
}

# Turn systemd on in wsl.conf: add [boot] systemd=true, keeping the rest of
# the file, after a backup. Nothing is removed.
enable_wsl_systemd() {
    local conf="${WSL_CONF:-/etc/wsl.conf}" cur out
    cur=$(mktemp) out=$(mktemp)
    [[ -f "$conf" ]] && cat "$conf" > "$cur"
    if grep -qiE '^[[:space:]]*systemd[[:space:]]*=' "$cur"; then
        awk '{ if (tolower($0) ~ /^[ \t]*systemd[ \t]*=/) print "systemd=true"; else print }' "$cur" > "$out"
    elif grep -qiE '^\[boot\]' "$cur"; then
        awk '{ print } tolower($0) ~ /^\[boot\]/ { print "systemd=true" }' "$cur" > "$out"
    else
        { cat "$cur"; printf '\n[boot]\nsystemd=true\n'; } > "$out"
    fi
    local rc=0
    if [[ -n "${WSL_CONF:-}" || "$(id -u)" == 0 ]]; then
        { [[ ! -f "$conf" ]] || cp "$conf" "$conf.agentos-bak"; } && cp "$out" "$conf" || rc=$?
    else
        { [[ ! -f "$conf" ]] || sudo cp "$conf" "$conf.agentos-bak"; } && sudo cp "$out" "$conf" || rc=$?
    fi
    rm -f "$cur" "$out"
    return $rc
}

# Register the Windows logon task (current user, no admin) and run it once.
enable_wsl_logon_task() {
    if ! command -v schtasks.exe &> /dev/null; then
        log_warn "schtasks.exe isn't reachable from WSL; keep a terminal open or start the distro from Windows"
        return 0
    fi
    if [[ -z "${WSL_DISTRO_NAME:-}" ]]; then
        log_warn "WSL_DISTRO_NAME isn't set here, so no Windows login task was made. Run 'agent-os enable' from a normal WSL terminal."
        return 0
    fi
    local name launcher
    name=$(wsl_task_name "$WSL_DISTRO_NAME")
    launcher=$(wsl_launcher "$WSL_DISTRO_NAME" 1)
    if schtasks.exe /Create /F /SC ONLOGON /TN "$name" /TR "$launcher" > /dev/null 2>&1; then
        schtasks.exe /Run /TN "$name" > /dev/null 2>&1 || true
        log_success "Windows login task \"$name\" keeps the distro running"
    else
        log_warn "Couldn't create the Windows login task. Without it WSL stops the distro, and AgentOS, when no terminal is open."
    fi
}

cmd_enable() {
    if [[ ! -d "$REPO_DIR" ]]; then
        log_error "AgentOS is not installed. Run 'agent-os install' first."
        exit 1
    fi

    if [[ "$OS" == "macos" ]]; then
        local result path managed=false
        path=$(launchd_plist_path)
        launchd_loaded && launchd_keeps_alive && managed=true
        if [[ "$(service_file_state)" == same && "$managed" == true ]]; then
            log_success "Auto-start already enabled (launchd)"
            echo "  Plist: $path"
            return 0
        fi
        # launchd runs the server itself from now on: one started by hand
        # (or by the old plist) would hold the port it needs.
        if is_running && [[ "$managed" == false ]]; then
            cmd_stop
        fi
        result=$(service_reconcile)
        [[ "$result" == updated ]] && log_info "Updated $path"
        if launchd_bootstrap; then
            log_success "Auto-start enabled (launchd): AgentOS starts at login and restarts after a crash"
        else
            launchd_no_gui_session
        fi
        echo "  Plist: $path"

    elif has_systemd; then
        local service_path
        service_path=$(systemd_unit_path)
        # Writes the unit only when it differs; the rest is safe to repeat.
        service_reconcile > /dev/null

        systemctl --user daemon-reload
        systemctl --user enable agent-os
        enable_linger
        log_success "Auto-start enabled (systemd)"
        echo "  Service: $service_path"
        if [[ "${WSL:-0}" != 0 ]]; then
            enable_wsl_logon_task
        fi

    elif [[ "${WSL:-0}" != 0 ]]; then
        log_error "Auto-start under WSL needs systemd. Add this to /etc/wsl.conf:"
        echo "    [boot]"
        echo "    systemd=true"
        echo "  then run 'wsl --shutdown' from Windows, reopen your terminal, and run"
        echo "  'agent-os enable' again."
        if is_interactive && prompt_yn "Add it to ${WSL_CONF:-/etc/wsl.conf} for you?" "y"; then
            if enable_wsl_systemd; then
                echo ""
                log_success "systemd is on for the next start. Run 'wsl --shutdown' from Windows, reopen, then 'agent-os enable'."
                return 0
            fi
        fi
        exit 1

    else
        log_error "Could not detect init system (launchd/systemd)"
        exit 1
    fi
}

cmd_disable() {
    if [[ "$OS" == "macos" ]]; then
        local plist_path="$HOME/Library/LaunchAgents/com.agent-os.plist"

        if [[ -f "$plist_path" ]]; then
            launchd_bootout
            rm -f "$plist_path" "$PID_FILE"
            log_success "Auto-start disabled"
        else
            log_warn "Auto-start was not enabled"
        fi

    elif has_systemd; then
        systemctl --user disable agent-os 2>/dev/null || true
        rm -f "$HOME/.config/systemd/user/agent-os.service"
        systemctl --user daemon-reload
        if [[ "${WSL:-0}" != 0 && -n "${WSL_DISTRO_NAME:-}" ]] && command -v schtasks.exe &> /dev/null; then
            schtasks.exe /Delete /F /TN "$(wsl_task_name "$WSL_DISTRO_NAME")" > /dev/null 2>&1 || true
        fi
        log_success "Auto-start disabled (linger is left on; other services may use it)"

    else
        log_error "Could not detect init system"
        exit 1
    fi
}

cmd_uninstall() {
    echo ""
    log_warn "This will remove AgentOS and all its data."

    if ! prompt_yn "Are you sure?" "n"; then
        log_info "Cancelled"
        exit 0
    fi

    # Detect if installed via npm (check if script is in node_modules)
    local installed_via_npm=false
    if [[ "$SCRIPT_DIR" == *"node_modules"* ]]; then
        installed_via_npm=true
    fi

    # Stop if running
    if is_running; then
        cmd_stop
    fi

    # Disable auto-start
    cmd_disable 2>/dev/null || true

    # Remove CLI symlink (only for non-npm installs)
    if [[ "$installed_via_npm" == false ]]; then
        if [[ -L "$HOME/.local/bin/agent-os" ]]; then
            log_info "Removing CLI symlink..."
            rm -f "$HOME/.local/bin/agent-os"
        elif [[ -L "/usr/local/bin/agent-os" ]]; then
            # Legacy location
            log_info "Removing CLI symlink..."
            sudo rm -f "/usr/local/bin/agent-os"
        fi
    fi

    # Remove installation directory
    if [[ -d "$AGENT_OS_HOME" ]]; then
        log_info "Removing $AGENT_OS_HOME..."
        rm -rf "$AGENT_OS_HOME"
    fi

    log_success "AgentOS uninstalled"

    # If installed via npm, provide instructions to remove the global package
    if [[ "$installed_via_npm" == true ]]; then
        echo ""
        log_info "To completely remove the CLI, run:"
        echo "  npm uninstall -g @saadnvd1/agent-os"
    fi
}

cmd_start_foreground() {
    if [[ ! -d "$REPO_DIR" ]]; then
        log_error "AgentOS is not installed."
        exit 1
    fi

    cd "$REPO_DIR"

    # Create PID file before exec (PID stays the same after exec)
    echo "$$" > "$PID_FILE"

    # The server itself is the service's main process, not an npm wrapper:
    # with KillMode=process a wrapper's stop left the old server on the port.
    npm run --silent prestart || exit 1
    exec env NODE_ENV=production AGENTOS_SERVER=live node --import tsx server.ts
}

cmd_help() {
    echo ""
    echo -e "${BOLD}AgentOS${NC} - Self-hosted AI coding session manager"
    echo ""
    echo "Usage: agent-os <command>"
    echo ""
    echo "Commands:"
    echo "  install     Install AgentOS (auto-installs dependencies)"
    echo "  setup       Guided setup: background service, how devices reach it, phone"
    echo "  check       Can other devices reach this machine? Names the cause and the fix"
    echo "  run         Start server and open in browser"
    echo "  start       Start the server in background"
    echo "  stop        Stop the server"
    echo "  restart     Restart the server"
    echo "  status      Show server status and URLs"
    echo "  pair        Add a phone, tablet or laptop (prints a QR code)"
    echo "  connect     Turn on AgentOS Connect for this machine"
    echo "  disconnect  Turn Connect off; the tunnel closes within seconds"
    echo "  link        Link machines on your Connect account (link <name>, link accept <code>)"
    echo "  unlink      Unlink a machine linked through Connect"
    echo "  passkeys reset  Revoke every passkey (recovery; asks you to confirm)"
    echo "  logs        Tail server logs"
    echo "  update      Update to latest version"
    echo "  machine     Make this Linux box or WSL distro linkable from another AgentOS"
    echo "  enable      Enable auto-start on boot"
    echo "  disable     Disable auto-start"
    echo "  uninstall   Remove AgentOS completely"
    echo ""
    echo "Environment variables:"
    echo "  AGENT_OS_HOME   Installation directory (default: ~/.agent-os)"
    echo "  AGENT_OS_PORT   Server port (default: 3011)"
    echo ""
}
