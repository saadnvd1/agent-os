import { exec, spawn } from "child_process";
import { promisify } from "util";
import type { SSHConnection } from "./db/types";

const execAsync = promisify(exec);

export interface SSHExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Execute command over SSH (non-interactive)
 * Uses ControlMaster for connection reuse
 */
export async function sshExec(
  connection: SSHConnection,
  command: string,
  options?: { cwd?: string; timeout?: number }
): Promise<SSHExecResult> {
  const cdPrefix = options?.cwd ? `cd ${options.cwd} && ` : "";

  const sshArgs = [
    "ssh",
    "-p",
    String(connection.port),
    "-o",
    "ControlMaster=auto",
    "-o",
    "ControlPath=~/.ssh/control-%h-%p-%r",
    "-o",
    "ControlPersist=600",
  ];

  // Add key file if specified
  if (connection.key_path) {
    sshArgs.push("-i", connection.key_path);
  }

  sshArgs.push(
    `${connection.user}@${connection.host}`,
    `"${cdPrefix}${command}"`
  );

  const sshCmd = sshArgs.join(" ");

  try {
    const { stdout, stderr } = await execAsync(sshCmd, {
      timeout: options?.timeout || 30000,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error: unknown) {
    const err = error as {
      stdout?: string;
      stderr?: string;
      code?: number;
      message?: string;
    };
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || err.message || "Unknown error",
      exitCode: err.code || 1,
    };
  }
}

/**
 * Spawn SSH process for interactive/streaming (terminal PTY)
 */
export function sshSpawn(
  connection: SSHConnection,
  command: string,
  options?: { cwd?: string }
) {
  const cdPrefix = options?.cwd ? `cd ${options.cwd} && ` : "";

  const args = [
    "-p",
    String(connection.port),
    "-o",
    "ControlMaster=auto",
    "-o",
    "ControlPath=~/.ssh/control-%h-%p-%r",
    "-o",
    "ControlPersist=600",
  ];

  // Add key file if specified
  if (connection.key_path) {
    args.push("-i", connection.key_path);
  }

  args.push(
    `${connection.user}@${connection.host}`,
    `${cdPrefix}${command}`
  );

  return spawn("ssh", args, {
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/**
 * Test SSH connection
 */
export async function testSSHConnection(
  connection: SSHConnection
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await sshExec(connection, "echo 'connection_ok'", {
      timeout: 5000,
    });
    if (result.stdout.includes("connection_ok")) {
      return { success: true };
    }
    return { success: false, error: result.stderr };
  } catch (error: unknown) {
    const err = error as { message?: string };
    return { success: false, error: err.message || "Unknown error" };
  }
}

/**
 * Check if remote host has required dependencies
 */
export async function checkRemoteDependencies(
  connection: SSHConnection
): Promise<{ tmux: boolean; git: boolean; claude?: boolean }> {
  const result = await sshExec(
    connection,
    "command -v tmux && command -v git && command -v claude"
  );

  return {
    tmux: result.stdout.includes("tmux"),
    git: result.stdout.includes("git"),
    claude: result.stdout.includes("claude"),
  };
}
