#!/usr/bin/env bash
# Command implementations for agent-os

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
    npm install --legacy-peer-deps

    # Build for production
    log_info "Building for production..."
    npm run build

    # Create CLI symlink (prefer ~/.local/bin to avoid sudo)
    log_info "Adding agent-os to PATH..."
    local bin_dir="$HOME/.local/bin"
    local needs_path_update=false

    mkdir -p "$bin_dir"
    ln -sf "$REPO_DIR/scripts/agent-os" "$bin_dir/agent-os"

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
    echo "  agent-os start     Start the server"
    echo "  agent-os enable    Auto-start on boot"
    echo "  agent-os status    Show URLs"
}

cmd_start() {
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
        ((count++))
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

    # Open in browser
    if [[ "$OS" == "macos" ]]; then
        open "$url"
    elif command -v xdg-open &> /dev/null; then
        xdg-open "$url"
    elif command -v wslview &> /dev/null; then
        wslview "$url"
    else
        log_warn "Could not detect browser. Open manually: $url"
    fi
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
        npm install --legacy-peer-deps

        log_info "Rebuilding..."
        npm run build

        log_success "Update complete!"
    fi

    if [[ "$was_running" == true ]]; then
        cmd_start
    fi
}

cmd_enable() {
    if [[ ! -d "$REPO_DIR" ]]; then
        log_error "AgentOS is not installed. Run 'agent-os install' first."
        exit 1
    fi

    local script_path
    script_path=$(realpath "$0")

    if [[ "$OS" == "macos" ]]; then
        local plist_path="$HOME/Library/LaunchAgents/com.agent-os.plist"

        cat > "$plist_path" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.agent-os</string>
    <key>ProgramArguments</key>
    <array>
        <string>$script_path</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>$LOG_FILE</string>
    <key>StandardErrorPath</key>
    <string>$LOG_FILE</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
EOF

        launchctl load "$plist_path" 2>/dev/null || true
        log_success "Auto-start enabled (launchd)"
        echo "  Plist: $plist_path"

    elif [[ -d /etc/systemd ]]; then
        local service_dir="$HOME/.config/systemd/user"
        local service_path="$service_dir/agent-os.service"

        mkdir -p "$service_dir"

        cat > "$service_path" << EOF
[Unit]
Description=AgentOS - AI Coding Session Manager
After=network.target

[Service]
Type=simple
ExecStart=$script_path start-foreground
Restart=on-failure
RestartSec=10
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
EOF

        systemctl --user daemon-reload
        systemctl --user enable agent-os
        log_success "Auto-start enabled (systemd)"
        echo "  Service: $service_path"

    else
        log_error "Could not detect init system (launchd/systemd)"
        exit 1
    fi
}

cmd_disable() {
    if [[ "$OS" == "macos" ]]; then
        local plist_path="$HOME/Library/LaunchAgents/com.agent-os.plist"

        if [[ -f "$plist_path" ]]; then
            launchctl unload "$plist_path" 2>/dev/null || true
            rm -f "$plist_path"
            log_success "Auto-start disabled"
        else
            log_warn "Auto-start was not enabled"
        fi

    elif [[ -d /etc/systemd ]]; then
        systemctl --user disable agent-os 2>/dev/null || true
        rm -f "$HOME/.config/systemd/user/agent-os.service"
        systemctl --user daemon-reload
        log_success "Auto-start disabled"

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

    # Stop if running
    if is_running; then
        cmd_stop
    fi

    # Disable auto-start
    cmd_disable 2>/dev/null || true

    # Remove CLI symlink
    if [[ -L "$HOME/.local/bin/agent-os" ]]; then
        log_info "Removing CLI symlink..."
        rm -f "$HOME/.local/bin/agent-os"
    elif [[ -L "/usr/local/bin/agent-os" ]]; then
        # Legacy location
        log_info "Removing CLI symlink..."
        sudo rm -f "/usr/local/bin/agent-os"
    fi

    # Remove installation
    if [[ -d "$AGENT_OS_HOME" ]]; then
        log_info "Removing $AGENT_OS_HOME..."
        rm -rf "$AGENT_OS_HOME"
    fi

    log_success "AgentOS uninstalled"
}

cmd_start_foreground() {
    if [[ ! -d "$REPO_DIR" ]]; then
        log_error "AgentOS is not installed."
        exit 1
    fi

    cd "$REPO_DIR"
    exec npm start
}

cmd_help() {
    echo ""
    echo -e "${BOLD}AgentOS${NC} - Self-hosted AI coding session manager"
    echo ""
    echo "Usage: agent-os <command>"
    echo ""
    echo "Commands:"
    echo "  install     Install AgentOS (auto-installs dependencies)"
    echo "  run         Start server and open in browser"
    echo "  start       Start the server in background"
    echo "  stop        Stop the server"
    echo "  restart     Restart the server"
    echo "  status      Show server status and URLs"
    echo "  logs        Tail server logs"
    echo "  update      Update to latest version"
    echo "  enable      Enable auto-start on boot"
    echo "  disable     Disable auto-start"
    echo "  uninstall   Remove AgentOS completely"
    echo ""
    echo "Environment variables:"
    echo "  AGENT_OS_HOME   Installation directory (default: ~/.agent-os)"
    echo "  AGENT_OS_PORT   Server port (default: 3011)"
    echo ""
}
