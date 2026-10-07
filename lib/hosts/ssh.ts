import { execFile, exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export const LOCAL_HOST_ID = "local";

// Reuse one authenticated connection per host for the poll loop and attaches.
// /tmp keeps the socket path under the 104-byte limit on macOS.
export const SSH_OPTIONS = [
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=5",
  "-o",
  "ServerAliveInterval=15",
  "-o",
  "ControlMaster=auto",
  "-o",
  "ControlPath=/tmp/agentos-ssh-%C",
  "-o",
  "ControlPersist=120",
];

const SSH_TARGET_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._@:-]*$/;

export function isValidSshTarget(target: string): boolean {
  return SSH_TARGET_PATTERN.test(target);
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// Non-interactive ssh skips login profiles, so tmux and agent CLIs installed
// via Homebrew or ~/.local/bin would be missing from PATH without -l.
export function loginShellCommand(command: string): string {
  return `exec "\${SHELL:-/bin/sh}" -lc ${shellQuote(command)}`;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export async function runOnTarget(
  sshTarget: string | null,
  command: string,
  timeout = 10000
): Promise<ExecResult> {
  if (!sshTarget) {
    return execAsync(command, { timeout });
  }
  if (!isValidSshTarget(sshTarget)) {
    throw new Error(`Invalid ssh target: ${sshTarget}`);
  }
  return execFileAsync(
    "ssh",
    [...SSH_OPTIONS, sshTarget, loginShellCommand(command)],
    { timeout }
  );
}

// A program and its arguments: run directly here (no shell, one process),
// or as a quoted command line over ssh.
export async function runFileOnTarget(
  sshTarget: string | null,
  file: string,
  args: string[],
  timeout = 10000
): Promise<ExecResult> {
  if (!sshTarget)
    return execFileAsync(file, args, { timeout, maxBuffer: 8 << 20 });
  return runOnTarget(
    sshTarget,
    [file, ...args].map(shellQuote).join(" "),
    timeout
  );
}
