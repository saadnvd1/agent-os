import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Generate an init script that shows the AgentOS banner and configures tmux
 */
function generateInitScript(agentCommand: string): string {
  return `#!/bin/bash
# AgentOS Session Init Script
# Auto-generated - do not edit manually

# ANSI Colors (purple theme)
C_RESET=$'\\033[0m'
C_PURPLE=$'\\033[38;5;141m'
C_PURPLE2=$'\\033[38;5;177m'
C_PINK=$'\\033[38;5;213m'
C_MUTED=$'\\033[38;5;245m'

# Configure tmux status bar
tmux set-option status-style 'bg=#1e1e2e,fg=#cdd6f4' 2>/dev/null
tmux set-option status-left '#[fg=#cba6f7,bold] AgentOS #[fg=#6c7086]| ' 2>/dev/null
tmux set-option status-left-length 20 2>/dev/null
tmux set-option status-right '#[fg=#6c7086]| #[fg=#89b4fa]#S #[fg=#6c7086]| #[fg=#a6adc8]%H:%M ' 2>/dev/null
tmux set-option status-right-length 40 2>/dev/null
tmux set-option status-position bottom 2>/dev/null

# Clear and show banner
clear

printf "\\n"
printf "\${C_PURPLE}     _                    _    ___  ____  \${C_RESET}\\n"
printf "\${C_PURPLE}    / \\\\   __ _  ___ _ __ | |_ / _ \\\\/ ___| \${C_RESET}\\n"
printf "\${C_PURPLE2}   / _ \\\\ / _\\\` |/ _ \\\\ '_ \\\\| __| | | \\\\___ \\\\ \${C_RESET}\\n"
printf "\${C_PURPLE2}  / ___ \\\\ (_| |  __/ | | | |_| |_| |___) |\${C_RESET}\\n"
printf "\${C_PINK} /_/   \\\\_\\\\__, |\\\\___|_| |_|\\\\__|\\\\___/|____/ \${C_RESET}\\n"
printf "\${C_PINK}         |___/                            \${C_RESET}\\n"
printf "\\n"
printf "\${C_MUTED}         AI Coding Session Manager\${C_RESET}\\n"
printf "\\n"

# Brief pause to show banner
sleep 0.8

# Ensure ~/.local/bin is in PATH (where claude is installed)
export PATH="$HOME/.local/bin:$PATH"

# Start the agent
exec ${agentCommand}
`;
}

// POST /api/sessions/init-script - Create init script and return path
export async function POST(request: NextRequest) {
  try {
    const { agentCommand } = await request.json();

    if (!agentCommand) {
      return NextResponse.json({ error: "agentCommand is required" }, { status: 400 });
    }

    const scriptContent = generateInitScript(agentCommand);
    const scriptPath = path.join(os.tmpdir(), `agent-os-init-${Date.now()}.sh`);

    fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

    return NextResponse.json({ scriptPath, command: `bash ${scriptPath}` });
  } catch (error) {
    console.error("Error creating init script:", error);
    return NextResponse.json({ error: "Failed to create init script" }, { status: 500 });
  }
}
