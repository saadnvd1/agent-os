#!/usr/bin/env bash
# The background service: launchd on macOS, systemd elsewhere. One render per
# init system, and one reconcile that writes only what changed, used by
# `agent-os enable` and `agent-os setup`.

LAUNCHD_LABEL="com.agent-os"

launchd_plist_path() { echo "$HOME/Library/LaunchAgents/$LAUNCHD_LABEL.plist"; }
systemd_unit_path() { echo "$HOME/.config/systemd/user/agent-os.service"; }
launchd_domain() { echo "gui/$(id -u)"; }

# launchd | systemd | none
service_kind() {
    if [[ "$OS" == "macos" ]]; then
        echo launchd
    elif has_systemd; then
        echo systemd
    else
        echo none
    fi
}

service_path() {
    case "$(service_kind)" in
        launchd) launchd_plist_path ;;
        systemd) systemd_unit_path ;;
    esac
}

# The server runs in the foreground as launchd's own process, so a crash is
# restarted (a clean exit isn't), and terminals (tmux) and chat workers
# outlive a restart, as KillMode=process does on Linux.
render_launchd_plist() {
    local script_path="$1"
    cat << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LAUNCHD_LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$script_path</string>
        <string>start-foreground</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>AbandonProcessGroup</key>
    <true/>
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
}

# What `agent-os enable` wrote before: it ran `agent-os start`, which exits at
# once, so launchd never restarted a crashed server. Recognised so setup can
# offer the update rather than calling it yours.
render_launchd_plist_v1() {
    local script_path="$1"
    cat << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LAUNCHD_LABEL</string>
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
}

render_systemd_unit() {
    local script_path="$1"
    cat << EOF
[Unit]
Description=AgentOS - AI Coding Session Manager
After=network.target

[Service]
Type=simple
ExecStart=$script_path start-foreground
Restart=on-failure
RestartSec=10
# Only the server is stopped on a restart: terminals (tmux), chat workers and
# an update in progress outlive it, as they do under launchd.
KillMode=process
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
EOF
}

render_service() {
    case "$(service_kind)" in
        launchd) render_launchd_plist "$1" ;;
        systemd) render_systemd_unit "$1" ;;
    esac
}

service_script_path() { realpath "$0"; }

# absent | same | older | changed: the file on disk against what we'd write.
service_file_state() {
    local path script_path
    path=$(service_path)
    script_path=$(service_script_path)
    if [[ -z "$path" || ! -f "$path" ]]; then
        echo absent
    elif [[ "$(cat "$path")" == "$(render_service "$script_path")" ]]; then
        echo same
    elif [[ "$(service_kind)" == launchd && "$(cat "$path")" == "$(render_launchd_plist_v1 "$script_path")" ]]; then
        echo older
    else
        echo changed
    fi
}

# Writes the service file when it differs. Prints unchanged | installed |
# updated | kept-yours. "keep" leaves a file that isn't ours as it is.
service_reconcile() {
    local mode="${1:-replace}" state path
    state=$(service_file_state)
    path=$(service_path)
    case "$state" in
        same) echo unchanged; return 0 ;;
        changed) if [[ "$mode" == keep ]]; then echo kept-yours; return 0; fi ;;
    esac
    mkdir -p "${path%/*}"
    render_service "$(service_script_path)" > "$path"
    [[ "$state" == absent ]] && echo installed || echo updated
}

launchd_loaded() {
    launchctl print "$(launchd_domain)/$LAUNCHD_LABEL" > /dev/null 2>&1
}

# Whether the plist on disk is the foreground one launchd can keep alive.
launchd_keeps_alive() {
    local path
    path=$(launchd_plist_path)
    [[ -f "$path" ]] && grep -q "<string>start-foreground</string>" "$path"
}

# (Re)load the agent. bootout first: bootstrap refuses an agent already
# loaded. Fails over ssh with no GUI login: the caller says what to do.
launchd_bootstrap() {
    launchctl bootout "$(launchd_domain)/$LAUNCHD_LABEL" > /dev/null 2>&1 || true
    launchctl bootstrap "$(launchd_domain)" "$(launchd_plist_path)" 2> /dev/null
}

launchd_no_gui_session() {
    log_warn "launchd wouldn't load AgentOS in this session (no-gui-session: no desktop login, for example over ssh)."
    echo "  Run 'agent-os enable' once from a terminal on the Mac itself."
}

launchd_bootout() {
    launchctl bootout "$(launchd_domain)/$LAUNCHD_LABEL" > /dev/null 2>&1 || true
}

launchd_restart() {
    launchctl kickstart -k "$(launchd_domain)/$LAUNCHD_LABEL" > /dev/null 2>&1
}
