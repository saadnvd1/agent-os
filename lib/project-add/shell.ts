import { spawn, type ChildProcess } from "child_process";
import { hostExec, sshTargetFor } from "../hosts";
import {
  isValidSshTarget,
  loginShellCommand,
  shellQuote,
  SSH_OPTIONS,
} from "../hosts/ssh";

// A path for a shell command on any machine: quoted, with a leading ~ left
// to that machine's $HOME.
export function shellPath(p: string): string {
  if (p === "~") return `"$HOME"`;
  if (p.startsWith("~/")) return `"$HOME"/${shellQuote(p.slice(2))}`;
  return shellQuote(p);
}

export async function run(
  hostId: string,
  command: string,
  timeout = 20_000
): Promise<string> {
  const { stdout } = await hostExec(hostId, command, timeout);
  return stdout;
}

// A long command whose output is wanted as it comes (git clone --progress).
export function spawnOn(hostId: string, command: string): ChildProcess {
  const target = sshTargetFor(hostId);
  if (!target) return spawn("/bin/sh", ["-c", command]);
  if (!isValidSshTarget(target)) throw new Error(`Invalid ssh target`);
  return spawn("ssh", [...SSH_OPTIONS, target, loginShellCommand(command)]);
}
