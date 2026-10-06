// Whether `agent-os passkeys reset` may run here: never from inside an
// AgentOS session or an agent's shell, and only at a real terminal.

export function resetRefusal(
  env: Record<string, string | undefined>,
  interactive: boolean
): string | null {
  if (env.AGENTOS_SESSION_ID)
    return "Refusing: this runs inside an AgentOS session. Run it yourself in a terminal you opened.";
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT)
    return "Refusing: this looks like an agent's shell. Run it yourself in a terminal you opened.";
  if (!interactive)
    return "Refusing: run this at an interactive terminal, not from a script or pipe.";
  return null;
}

export const RESET_PHRASE = "reset passkeys";
