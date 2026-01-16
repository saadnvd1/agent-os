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

    # Add to shell profile so it's available in future sessions
    local shell_profile=""
    if [[ -n "$ZSH_VERSION" ]] && [[ -f "$HOME/.zshrc" ]]; then
        shell_profile="$HOME/.zshrc"
    elif [[ -n "$BASH_VERSION" ]] && [[ -f "$HOME/.bashrc" ]]; then
        shell_profile="$HOME/.bashrc"
    elif [[ -f "$HOME/.bash_profile" ]]; then
        shell_profile="$HOME/.bash_profile"
    fi

    if [[ -n "$shell_profile" ]]; then
        if ! grep -q "brew shellenv" "$shell_profile"; then
            echo '' >> "$shell_profile"
            echo '# Homebrew' >> "$shell_profile"
            if [[ -f /opt/homebrew/bin/brew ]]; then
                echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$shell_profile"
            elif [[ -f /usr/local/bin/brew ]]; then
                echo 'eval "$(/usr/local/bin/brew shellenv)"' >> "$shell_profile"
            fi
        fi
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
            # Check if user is admin - if not, use fnm (user-space install)
            if ! groups | grep -q admin; then
                log_info "Non-admin user detected - using fnm (Fast Node Manager)"
                log_info "This installs Node.js to your home directory (no sudo needed)"

                # Install fnm
                curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell

                # Add fnm to path for current session
                export PATH="$HOME/.local/share/fnm:$PATH"
                eval "$(fnm env --use-on-cd)"

                # Install and use Node.js 20
                fnm install 20
                fnm use 20

                # Add fnm to shell profile
                local shell_profile=""
                if [[ -f "$HOME/.zshrc" ]]; then
                    shell_profile="$HOME/.zshrc"
                elif [[ -f "$HOME/.bashrc" ]]; then
                    shell_profile="$HOME/.bashrc"
                elif [[ -f "$HOME/.bash_profile" ]]; then
                    shell_profile="$HOME/.bash_profile"
                fi

                if [[ -n "$shell_profile" ]]; then
                    if ! grep -q "fnm env" "$shell_profile"; then
                        echo '' >> "$shell_profile"
                        echo '# fnm (Fast Node Manager)' >> "$shell_profile"
                        echo 'eval "$(fnm env --use-on-cd)"' >> "$shell_profile"
                        log_info "Added fnm to $shell_profile"
                    fi
                fi
            else
                # Admin user - use Homebrew
                install_homebrew
                brew install node
            fi
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
            # Check if user is admin
            if ! groups | grep -q admin; then
                log_error "tmux requires admin privileges to install via Homebrew."
                log_error ""
                log_error "Option 1: Ask your administrator to run: brew install tmux"
                log_error "Option 2: Make yourself an admin:"
                log_error "  - Open System Settings → Users & Groups"
                log_error "  - Unlock and check 'Allow user to administer this computer'"
                exit 1
            else
                install_homebrew
                brew install tmux
            fi
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

install_ripgrep() {
    if command -v rg &> /dev/null; then
        return 0
    fi

    log_info "Installing ripgrep..."

    case "$OS" in
        macos)
            # Check if user is admin
            if ! groups | grep -q admin; then
                # Non-admin: download pre-built binary from GitHub
                log_info "Non-admin user - downloading pre-built ripgrep binary"

                local arch
                arch=$(uname -m)
                local target
                if [[ "$arch" == "arm64" ]]; then
                    target="aarch64-apple-darwin"
                else
                    target="x86_64-apple-darwin"
                fi

                local version="14.1.0"
                local url="https://github.com/BurntSushi/ripgrep/releases/download/${version}/ripgrep-${version}-${target}.tar.gz"
                local tmp_dir="/tmp/ripgrep-install"

                mkdir -p "$tmp_dir"
                mkdir -p "$HOME/.local/bin"

                curl -fsSL "$url" | tar -xz -C "$tmp_dir"
                mv "$tmp_dir/ripgrep-${version}-${target}/rg" "$HOME/.local/bin/rg"
                chmod +x "$HOME/.local/bin/rg"
                rm -rf "$tmp_dir"

                # Add to PATH if not already there
                export PATH="$HOME/.local/bin:$PATH"

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
                    if ! grep -q '.local/bin' "$shell_profile"; then
                        echo '' >> "$shell_profile"
                        echo '# Add local bin to PATH' >> "$shell_profile"
                        echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$shell_profile"
                    fi
                fi

                log_success "ripgrep installed to ~/.local/bin/rg"
            else
                # Admin user - use Homebrew
                install_homebrew
                brew install ripgrep
            fi
            ;;
        debian)
            sudo apt-get update
            sudo apt-get install -y ripgrep
            ;;
        redhat)
            sudo yum install -y ripgrep
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

    # Check ripgrep
    command -v rg &> /dev/null || missing+=("ripgrep")

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
            ripgrep) install_ripgrep ;;
        esac
    done

    log_success "Prerequisites installed"
}
