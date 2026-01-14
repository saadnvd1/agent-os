#!/usr/bin/env bash
# Prerequisite installation for agent-os

install_homebrew() {
    if command -v brew &> /dev/null; then
        return 0
    fi

    log_info "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    # Add to path for current session
    if [[ -f /opt/homebrew/bin/brew ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -f /usr/local/bin/brew ]]; then
        eval "$(/usr/local/bin/brew shellenv)"
    fi
}

install_node() {
    if command -v node &> /dev/null; then
        local version
        version=$(node -v | sed 's/v//' | cut -d. -f1)
        if [[ "$version" -ge 20 ]]; then
            return 0
        fi
        log_warn "Node.js $version found, but 20+ required"
    fi

    log_info "Installing Node.js..."

    case "$OS" in
        macos)
            install_homebrew
            brew install node
            ;;
        debian)
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs
            ;;
        redhat)
            curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
            sudo yum install -y nodejs
            ;;
        *)
            log_error "Please install Node.js 20+ manually: https://nodejs.org"
            exit 1
            ;;
    esac
}

install_git() {
    if command -v git &> /dev/null; then
        return 0
    fi

    log_info "Installing git..."

    case "$OS" in
        macos)
            xcode-select --install 2>/dev/null || true
            until command -v git &> /dev/null; do
                sleep 5
            done
            ;;
        debian)
            sudo apt-get update
            sudo apt-get install -y git
            ;;
        redhat)
            sudo yum install -y git
            ;;
    esac
}

install_tmux() {
    if command -v tmux &> /dev/null; then
        return 0
    fi

    log_info "Installing tmux..."

    case "$OS" in
        macos)
            install_homebrew
            brew install tmux
            ;;
        debian)
            sudo apt-get update
            sudo apt-get install -y tmux
            ;;
        redhat)
            sudo yum install -y tmux
            ;;
    esac
}

check_and_install_prerequisites() {
    log_info "Checking prerequisites..."

    local missing=()

    # Check Node.js
    if ! command -v node &> /dev/null; then
        missing+=("node")
    else
        local version
        version=$(node -v | sed 's/v//' | cut -d. -f1)
        if [[ "$version" -lt 20 ]]; then
            missing+=("node")
        fi
    fi

    # Check git
    command -v git &> /dev/null || missing+=("git")

    # Check tmux
    command -v tmux &> /dev/null || missing+=("tmux")

    if [[ ${#missing[@]} -eq 0 ]]; then
        log_success "All prerequisites met"
        return 0
    fi

    log_warn "Missing prerequisites: ${missing[*]}"

    if is_interactive; then
        if ! prompt_yn "Install missing prerequisites?"; then
            log_error "Please install manually: ${missing[*]}"
            exit 1
        fi
    fi

    for dep in "${missing[@]}"; do
        case "$dep" in
            node) install_node ;;
            git) install_git ;;
            tmux) install_tmux ;;
        esac
    done

    log_success "Prerequisites installed"
}
