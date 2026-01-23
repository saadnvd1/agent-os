import { exec, execSync, spawn } from "child_process";
import { promisify } from "util";
import { sshExec, sshSpawn } from "./ssh";
import { db, queries, type Project } from "./db";
import { getSSHConnectionById } from "./ssh-connections";

const execAsync = promisify(exec);

export interface ExecOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Get project by ID
 */
function getProjectById(projectId: string): Project | null {
  return queries.getProject(db).get(projectId) as Project | null;
}

/**
 * Execute command, automatically using SSH if project is remote
 */
export async function execForProject(
  projectId: string,
  command: string,
  options?: ExecOptions
): Promise<ExecResult> {
  // Special case: "local" projectId means execute locally without project lookup
  if (projectId === "local") {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: options?.cwd,
        timeout: options?.timeout || 30000,
        env: { ...process.env, ...options?.env },
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

  const project = getProjectById(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const cwd = options?.cwd || project.working_directory;

  // Remote execution via SSH
  if (project.is_remote && project.ssh_connection_id) {
    const conn = getSSHConnectionById(project.ssh_connection_id);
    if (!conn) throw new Error(`SSH connection not found: ${project.ssh_connection_id}`);

    return sshExec(conn, command, {
      cwd,
      timeout: options?.timeout,
    });
  }

  // Local execution
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: options?.timeout || 30000,
      env: { ...process.env, ...options?.env },
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
 * Synchronous version for cases that need it
 * NOTE: Cannot be used for remote projects
 */
export function execSyncForProject(
  projectId: string,
  command: string,
  options?: ExecOptions
): { stdout: string; stderr: string } {
  const project = getProjectById(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  if (project.is_remote) {
    throw new Error("Cannot use execSync for remote projects - use execForProject instead");
  }

  const cwd = options?.cwd || project.working_directory;
  try {
    const stdout = execSync(command, {
      cwd,
      timeout: options?.timeout || 30000,
      env: { ...process.env, ...options?.env },
      encoding: "utf-8",
    });

    return { stdout: stdout.toString(), stderr: "" };
  } catch (error: unknown) {
    const err = error as { stdout?: Buffer; stderr?: Buffer; message?: string };
    return {
      stdout: err.stdout?.toString() || "",
      stderr: err.stderr?.toString() || err.message || "Unknown error",
    };
  }
}

/**
 * Spawn process for project (used by terminal PTY)
 */
export function spawnForProject(
  projectId: string,
  command: string,
  args: string[] = [],
  options?: ExecOptions
) {
  const project = getProjectById(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const cwd = options?.cwd || project.working_directory;

  // Remote execution via SSH spawn
  if (project.is_remote && project.ssh_connection_id) {
    const conn = getSSHConnectionById(project.ssh_connection_id);
    if (!conn) throw new Error(`SSH connection not found: ${project.ssh_connection_id}`);

    const fullCommand = args.length > 0 ? `${command} ${args.join(" ")}` : command;
    return sshSpawn(conn, fullCommand, { cwd });
  }

  // Local execution
  return spawn(command, args, {
    cwd,
    env: { ...process.env, ...options?.env },
  });
}
