#!/usr/bin/env bash
# AI CLI detection and installation for agent-os

detect_ai_clis() {
    local installed=()

    command -v claude &> /dev/null && installed+=("claude")
    command -v codex &> /dev/null && installed+=("codex")
    command -v opencode &> /dev/null && installed+=("opencode")
    command -v gemini &> /dev/null && installed+=("gemini")
    command -v aider &> /dev/null && installed+=("aider")
    command -v cursor &> /dev/null && installed+=("cursor")

    echo "${installed[*]}"
}

install_claude_code() {
    if command -v claude &> /dev/null; then
        log_success "Claude Code already installed"
        return 0
    fi

    log_info "Installing Claude Code..."
    curl -fsSL https://claude.ai/install.sh | bash

    if is_interactive; then
        log_info "Authenticating Claude Code..."
        echo ""
        echo "Please complete the authentication in your browser."
        read -p "Press Enter when ready to continue..." -r
        claude auth login
    else
        log_info "Run 'claude' to authenticate when ready"
    fi
}

install_codex() {
    if command -v codex &> /dev/null; then
        log_success "Codex already installed"
        return 0
    fi

    log_info "Installing Codex..."
    npm install -g @openai/codex

    log_info "Authenticating Codex..."
    echo ""
    echo "Please set your OPENAI_API_KEY environment variable."
    echo "Get your key at: https://platform.openai.com/api-keys"
}

install_aider() {
    if command -v aider &> /dev/null; then
        log_success "Aider already installed"
        return 0
    fi

    log_info "Installing Aider..."

    if command -v pipx &> /dev/null; then
        pipx install aider-chat
    elif command -v pip3 &> /dev/null; then
        pip3 install aider-chat
    else
        log_error "Please install Python/pip first, then run: pip install aider-chat"
        return 1
    fi
}

install_gemini_cli() {
    if command -v gemini &> /dev/null; then
        log_success "Gemini CLI already installed"
        return 0
    fi

    log_info "Installing Gemini CLI..."
    npm install -g @google/gemini-cli 2>/dev/null || npm install -g gemini-cli

    log_info "Authenticating Gemini CLI..."
    echo ""
    echo "Please complete the authentication."
    gemini auth login 2>/dev/null || true
}

prompt_ai_cli_install() {
    local installed
    installed=$(detect_ai_clis)

    if [[ -n "$installed" ]]; then
        log_success "Found AI CLI(s): $installed"
        return 0
    fi

    echo ""
    log_warn "No AI coding CLI detected"
    echo ""
    echo "AgentOS supports these AI coding assistants:"
    echo ""
    echo "  1) Claude Code (Anthropic) - Recommended"
    echo "  2) Codex (OpenAI)"
    echo "  3) Aider (Multi-LLM)"
    echo "  4) Gemini CLI (Google)"
    echo "  5) Skip - I'll install one myself"
    echo ""

    if ! is_interactive; then
        log_info "Non-interactive mode: Installing Claude Code by default"
        install_claude_code
        return
    fi

    read -p "Which would you like to install? [1-5, default: 1] " -r choice
    echo ""

    case "${choice:-1}" in
        1) install_claude_code ;;
        2) install_codex ;;
        3) install_aider ;;
        4) install_gemini_cli ;;
        5)
            log_info "Skipping AI CLI installation"
            echo ""
            echo "Install one of these before using AgentOS:"
            echo "  Claude Code: npm install -g @anthropic-ai/claude-code"
            echo "  Codex:       npm install -g @openai/codex"
            echo "  Aider:       pip install aider-chat"
            echo "  Gemini:      npm install -g gemini-cli"
            echo ""
            ;;
        *) log_warn "Invalid choice, skipping" ;;
    esac
}
