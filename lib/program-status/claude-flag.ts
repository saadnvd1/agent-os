// Claude sessions AgentOS starts on this machine report their state as
// OSC 7501 through these hooks (scripts/claude-status-hook.sh, installed by
// installClaudeStatusHooks). Client-safe: it's only the flag. "$HOME" is
// expanded by the shell that starts Claude.
export const CLAUDE_STATUS_SETTINGS_FLAG =
  '--settings "$HOME/.agent-os/claude-status-hooks.json"';
