import { SSH_OPTIONS, loginShellCommand, shellQuote } from "./ssh";
import { isValidTmuxName } from "./tmux-name";

export interface AttachSpec {
  sessionName: string;
  cwd?: string;
  command?: string;
  hostId?: string;
  // Reattach only; never create a bare session in place of a dead one.
  attachOnly?: boolean;
  // The AgentOS session this is; the server turns it into the bus env.
  sessionId?: string;
  env?: Record<string, string>;
}

export { isValidTmuxName };

// "~" and "$HOME" must expand on the machine the session runs on.
function cwdArg(cwd: string): string {
  const rest = cwd.replace(/^(~|\$HOME)/, "");
  if (rest === cwd) return shellQuote(cwd);
  return rest ? `"$HOME"${shellQuote(rest)}` : `"$HOME"`;
}

export function buildTmuxAttachCommand(spec: AttachSpec): string {
  if (!isValidTmuxName(spec.sessionName)) {
    throw new Error(`Invalid tmux session name: ${spec.sessionName}`);
  }
  // Commands chained after an attaching command only run once the client
  // detaches, so options go first; start-server keeps a fresh server alive.
  const prefix = "tmux start-server \\; set -g mouse on \\;";
  if (spec.attachOnly) {
    // Quoted: zsh expands a bare "=word" to a command path.
    return `${prefix} attach-session -t ${shellQuote(`=${spec.sessionName}`)}`;
  }
  const parts = ["new-session", "-A", "-s", spec.sessionName];
  if (spec.cwd) parts.push("-c", cwdArg(spec.cwd));
  for (const [k, v] of Object.entries(spec.env ?? {})) {
    parts.push("-e", shellQuote(`${k}=${v}`));
  }
  if (spec.command) parts.push(shellQuote(spec.command));
  return `${prefix} ${parts.join(" ")}`;
}

export function buildAttachProcess(
  spec: AttachSpec,
  sshTarget: string | null,
  localShell: string
): { file: string; args: string[] } {
  const tmuxCommand = buildTmuxAttachCommand(spec);
  if (!sshTarget) return { file: localShell, args: ["-lc", tmuxCommand] };
  return {
    file: "ssh",
    args: [...SSH_OPTIONS, "-t", sshTarget, loginShellCommand(tmuxCommand)],
  };
}
