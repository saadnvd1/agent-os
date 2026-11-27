#!/usr/bin/env bash
# AI CLI detection and installation for agent-os

detect_ai_clis() {
    # A plain string, not an array: macOS's bash 3.2 treats "${arr[*]}" of an
    # empty array as unbound under set -u, which crashed setup for a user with
    # no AI CLI installed yet.
    local installed="" cli
    for cli in claude codex opencode kilo gemini aider cursor; do
        if have_cli "$cli"; then
            installed="$installed $cli"
        fi
    done

    echo "${installed# }"
}

# The manual install commands, one per line.
ai_cli_manual_help() {
    echo "  Claude Code: npm install -g @anthropic-ai/claude-code"
    echo "  Codex:       npm install -g @openai/codex"
    echo "  Aider:       pipx install aider-chat"
    echo "  Gemini:      npm install -g @google/gemini-cli"
    echo "  Kilo Code:   npm install -g @kilocode/cli"
}

# Run one agent CLI installer. Not having an agent yet must never stop the
# install (the first screen can set one up), so a failure names the cause and
# the manual command and carries on.
ai_cli_try() {
    local name="$1" manual="$2"
    shift 2
    if "$@"; then
        return 0
    fi
    log_warn "Couldn't install $name. AgentOS is still installing; add $name later with:"
    echo "  $manual"
    echo "  (a permission error from npm usually means your Node is system-wide: use nvm or fnm, or add sudo)"
    return 0
}

install_claude_code() {
    if have_cli claude; then
        log_success "Claude Code already installed"
        return 0
    fi

    log_info "Installing Claude Code..."
    curl -fsSL https://claude.ai/install.sh | bash || return 1

    if is_interactive && have_cli claude; then
        log_info "Authenticating Claude Code..."
        echo ""
        echo "Please complete the authentication in your browser."
        read -p "Press Enter when ready to continue..." -r || true
        claude auth login || log_warn "Sign-in didn't finish. Run 'claude' later to sign in."
    else
        log_info "Run 'claude' to authenticate when ready"
    fi
}

install_codex() {
    if have_cli codex; then
        log_success "Codex already installed"
        return 0
    fi

    log_info "Installing Codex..."
    npm install -g @openai/codex || return 1

    log_info "Authenticating Codex..."
    echo ""
    echo "Please set your OPENAI_API_KEY environment variable."
    echo "Get your key at: https://platform.openai.com/api-keys"
}

install_aider() {
    if have_cli aider; then
        log_success "Aider already installed"
        return 0
    fi

    log_info "Installing Aider..."

    if have_cli pipx; then
        pipx install aider-chat
    elif have_cli pip3; then
        pip3 install aider-chat
    else
        log_error "Aider needs Python's pip. Install Python, then run: pipx install aider-chat"
        return 1
    fi
}

install_gemini_cli() {
    if have_cli gemini; then
        log_success "Gemini CLI already installed"
        return 0
    fi

    log_info "Installing Gemini CLI..."
    npm install -g @google/gemini-cli || return 1

    log_info "Authenticating Gemini CLI..."
    echo ""
    echo "Run 'gemini' to sign in when ready."
}

install_kilocode_cli() {
    if have_cli kilo; then
        log_success "Kilo Code CLI already installed"
        return 0
    fi

    log_info "Installing Kilo Code CLI..."
    npm install -g @kilocode/cli || return 1

    log_info "Authenticating Kilo Code CLI..."
    echo ""
    echo "Run 'kilo' to complete setup and authentication when ready."
}

prompt_ai_cli_install() {
    local installed choice=""
    installed=$(detect_ai_clis)

    if [[ -n "$installed" ]]; then
        log_success "Found AI CLI(s): $installed"
        return 0
    fi

    echo ""
    log_warn "No AI coding CLI detected"

    if ! is_interactive; then
        # Nothing is installed behind the user's back; AgentOS's first screen
        # installs and signs in an agent too.
        echo "AgentOS needs one agent CLI to run sessions. It can set one up from its"
        echo "first screen, or install one now:"
        ai_cli_manual_help
        echo ""
        return 0
    fi

    echo ""
    echo "AgentOS supports these AI coding assistants:"
    echo ""
    echo "  1) Claude Code (Anthropic) - Recommended"
    echo "  2) Codex (OpenAI)"
    echo "  3) Aider (Multi-LLM)"
    echo "  4) Gemini CLI (Google)"
    echo "  5) Kilo Code CLI (Kilo)"
    echo "  6) Skip - AgentOS can set one up from its first screen"
    echo ""

    read -p "Which would you like to install? [1-6, default: 1] " -r choice || choice=6
    echo ""

    case "${choice:-1}" in
        1) ai_cli_try "Claude Code" "npm install -g @anthropic-ai/claude-code" install_claude_code ;;
        2) ai_cli_try "Codex" "npm install -g @openai/codex" install_codex ;;
        3) ai_cli_try "Aider" "pipx install aider-chat" install_aider ;;
        4) ai_cli_try "Gemini CLI" "npm install -g @google/gemini-cli" install_gemini_cli ;;
        5) ai_cli_try "Kilo Code CLI" "npm install -g @kilocode/cli" install_kilocode_cli ;;
        6)
            log_info "Skipping AI CLI installation"
            echo ""
            echo "Install one of these before starting a session (or use AgentOS's first screen):"
            ai_cli_manual_help
            echo ""
            ;;
        *) log_warn "Not an option (1-6), skipping. You can set an agent up from AgentOS's first screen." ;;
    esac
}
