/**
 * Orchestration System
 *
 * Allows a "conductor" session to spawn and manage worker sessions.
 * Each worker gets its own git worktree for isolation.
 */

import { randomUUID } from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import { db, queries, type Session } from "./db";
import { createWorktree, deleteWorktree } from "./worktrees";
import { setupWorktree } from "./env-setup";
import { getProvider } from "./providers";
import { statusDetector } from "./status-detector";

const execAsync = promisify(exec);

export interface SpawnWorkerOptions {
  conductorSessionId: string;
  task: string;
  workingDirectory: string;
  branchName?: string;
  useWorktree?: boolean;
  model?: string;
  agentType?: "claude" | "codex" | "opencode";
}

export interface WorkerInfo {
  id: string;
  name: string;
  task: string;
  status: "pending" | "running" | "waiting" | "idle" | "completed" | "failed" | "dead";
  worktreePath: string | null;
  branchName: string | null;
  createdAt: string;
}

/**
 * Generate a unique branch name from a task description
 */
function taskToBranchName(task: string): string {
  const base = task
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .slice(0, 4)
    .join("-")
    .slice(0, 30) || "worker";

  // Add short unique suffix to avoid conflicts
  const suffix = Date.now().toString(36).slice(-4);
  return `${base}-${suffix}`;
}

/**
 * Generate a short session name from a task description
 */
function taskToSessionName(task: string): string {
  // Take first 50 chars, trim to last complete word
  const truncated = task.slice(0, 50);
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated;
}

/**
 * Spawn a new worker session
 */
export async function spawnWorker(options: SpawnWorkerOptions): Promise<Session> {
  const {
    conductorSessionId,
    task,
    workingDirectory: rawWorkingDir,
    branchName = taskToBranchName(task),
    useWorktree = true,
    model = "sonnet",
    agentType = "claude",
  } = options;

  // Expand ~ to home directory
  const workingDirectory = rawWorkingDir.replace(/^~/, process.env.HOME || "");

  const sessionId = randomUUID();
  const sessionName = taskToSessionName(task);
  const provider = getProvider(agentType);

  let worktreePath: string | null = null;
  let actualWorkingDir = workingDirectory;

  // Create worktree if requested
  if (useWorktree) {
    try {
      const worktreeResult = await createWorktree({
        projectPath: workingDirectory,
        featureName: branchName,
      });
      worktreePath = worktreeResult.worktreePath;
      actualWorkingDir = worktreePath;

      // Set up environment (copy .env files, install deps)
      await setupWorktree({
        worktreePath,
        sourcePath: workingDirectory,
      });
    } catch (error) {
      console.error("Failed to create worktree:", error);
      // Fall back to same directory (no isolation)
    }
  }

  // Create session in database
  queries.createWorkerSession(db).run(
    sessionId,
    sessionName,
    actualWorkingDir,
    conductorSessionId,
    task,
    model,
    "sessions", // group_path
    agentType
  );

  // Update worktree info if created
  if (worktreePath) {
    queries.updateSessionWorktree(db).run(
      worktreePath,
      branchName,
      "main", // base_branch
      null,   // dev_server_port
      sessionId
    );
  }

  // Create tmux session and start the agent
  const tmuxSessionName = `${provider.id}-${sessionId}`;
  const cwd = actualWorkingDir.replace("~", "$HOME");

  // Build the initial prompt command (workers use auto-approve by default for automation)
  const flags = provider.buildFlags({ model, autoApprove: true });
  const flagsStr = flags.join(" ");

  // Create tmux session with the agent and send the task
  const createCmd = `tmux new-session -d -s "${tmuxSessionName}" -c "${cwd}" "${provider.command} ${flagsStr}"`;

  try {
    await execAsync(createCmd);

    // Wait for Claude to be ready by checking for the input prompt
    // Poll every 2 seconds for up to 30 seconds
    const maxWaitMs = 30000;
    const pollIntervalMs = 2000;
    let waited = 0;
    let ready = false;

    console.log(`[orchestration] Waiting for Claude to initialize in ${tmuxSessionName}...`);

    while (waited < maxWaitMs && !ready) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      waited += pollIntervalMs;

      try {
        const { stdout } = await execAsync(`tmux capture-pane -t '${tmuxSessionName}' -p -S -10 2>/dev/null`);
        const content = stdout.toLowerCase();

        // Check for trust/permissions prompt and auto-accept
        // Claude shows "Ready to code here?" with "Yes, continue" option - just press Enter
        if (content.includes('ready to code here') || content.includes('yes, continue') ||
            content.includes('need permission to work')) {
          console.log(`[orchestration] Trust prompt detected, pressing Enter to accept`);
          await execAsync(`tmux send-keys -t '${tmuxSessionName}' Enter`);
          continue; // Keep waiting for the real prompt
        }

        // Look for Claude's ready state - the "? for shortcuts" line indicates fully loaded
        const lines = stdout.trim().split('\n');
        const lastFewLines = lines.slice(-3).join('\n');
        if (lastFewLines.includes('? for shortcuts') || lastFewLines.includes('?>')) {
          ready = true;
          console.log(`[orchestration] Claude ready after ${waited}ms`);
        }
      } catch {
        // Session might not be ready yet
      }
    }

    if (!ready) {
      console.log(`[orchestration] Timed out waiting for Claude, sending task anyway after ${waited}ms`);
    }

    // Send the task as input, then press Enter
    const escapedTask = task.replace(/'/g, "'\\''"); // Escape single quotes for shell
    console.log(`[orchestration] Sending task to ${tmuxSessionName}: "${task}"`);
    try {
      await execAsync(`tmux send-keys -t '${tmuxSessionName}' -l '${escapedTask}'`);
      await execAsync(`tmux send-keys -t '${tmuxSessionName}' Enter`);
      console.log(`[orchestration] Task sent successfully to ${tmuxSessionName}`);
    } catch (sendError) {
      console.error(`[orchestration] Failed to send task to ${tmuxSessionName}:`, sendError);
    }

    // Update worker status to running
    queries.updateWorkerStatus(db).run("running", sessionId);
  } catch (error) {
    console.error("Failed to start worker session:", error);
    queries.updateWorkerStatus(db).run("failed", sessionId);
  }

  return queries.getSession(db).get(sessionId) as Session;
}

/**
 * Get all workers for a conductor session
 */
export async function getWorkers(conductorSessionId: string): Promise<WorkerInfo[]> {
  const workers = queries.getWorkersByConductor(db).all(conductorSessionId) as Session[];

  // Get live status for each worker
  const workerInfos: WorkerInfo[] = [];

  for (const worker of workers) {
    const provider = getProvider(worker.agent_type || "claude");
    const tmuxSessionName = `${provider.id}-${worker.id}`;

    // Get live status from tmux
    let liveStatus: string;
    try {
      liveStatus = await statusDetector.getStatus(tmuxSessionName);
    } catch {
      liveStatus = "dead";
    }

    // Combine DB status with live status
    let status: WorkerInfo["status"];
    if (worker.worker_status === "completed" || worker.worker_status === "failed") {
      status = worker.worker_status;
    } else if (liveStatus === "dead") {
      status = "dead";
    } else {
      status = liveStatus as WorkerInfo["status"];
    }

    workerInfos.push({
      id: worker.id,
      name: worker.name,
      task: worker.worker_task || "",
      status,
      worktreePath: worker.worktree_path,
      branchName: worker.branch_name,
      createdAt: worker.created_at,
    });
  }

  return workerInfos;
}

/**
 * Get recent output from a worker's terminal
 */
export async function getWorkerOutput(workerId: string, lines: number = 50): Promise<string> {
  const session = queries.getSession(db).get(workerId) as Session | undefined;
  if (!session) {
    throw new Error(`Worker ${workerId} not found`);
  }

  const provider = getProvider(session.agent_type || "claude");
  const tmuxSessionName = `${provider.id}-${workerId}`;

  try {
    const { stdout } = await execAsync(
      `tmux capture-pane -t "${tmuxSessionName}" -p -S -${lines} 2>/dev/null || echo ""`
    );
    return stdout.trim();
  } catch {
    return "";
  }
}

/**
 * Send a message/command to a worker
 */
export async function sendToWorker(workerId: string, message: string): Promise<boolean> {
  const session = queries.getSession(db).get(workerId) as Session | undefined;
  if (!session) {
    throw new Error(`Worker ${workerId} not found`);
  }

  const provider = getProvider(session.agent_type || "claude");
  const tmuxSessionName = `${provider.id}-${workerId}`;

  try {
    const escapedMessage = message.replace(/"/g, '\\"').replace(/\$/g, '\\$');
    await execAsync(`tmux send-keys -t "${tmuxSessionName}" "${escapedMessage}" Enter`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mark a worker as completed
 */
export function completeWorker(workerId: string): void {
  queries.updateWorkerStatus(db).run("completed", workerId);
}

/**
 * Mark a worker as failed
 */
export function failWorker(workerId: string): void {
  queries.updateWorkerStatus(db).run("failed", workerId);
}

/**
 * Kill a worker session and optionally clean up its worktree
 */
export async function killWorker(workerId: string, cleanupWorktree: boolean = false): Promise<void> {
  const session = queries.getSession(db).get(workerId) as Session | undefined;
  if (!session) {
    return;
  }

  const provider = getProvider(session.agent_type || "claude");
  const tmuxSessionName = `${provider.id}-${workerId}`;

  // Kill tmux session
  try {
    await execAsync(`tmux kill-session -t "${tmuxSessionName}" 2>/dev/null || true`);
  } catch {
    // Ignore errors
  }

  // Clean up worktree if requested
  // Note: This requires knowing the original project path, which we derive from git
  if (cleanupWorktree && session.worktree_path) {
    try {
      // Get the main worktree (original project) from git
      const { stdout } = await execAsync(
        `git -C "${session.worktree_path}" worktree list --porcelain | head -1 | sed 's/worktree //'`
      );
      const projectPath = stdout.trim();
      if (projectPath && projectPath !== session.worktree_path) {
        await deleteWorktree(session.worktree_path, projectPath, true);
      }
    } catch (error) {
      console.error("Failed to delete worktree:", error);
      // Fallback: just remove the directory
      try {
        await execAsync(`rm -rf "${session.worktree_path}"`);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  queries.updateWorkerStatus(db).run("failed", workerId);
}

/**
 * Get a summary of all workers' statuses
 */
export async function getWorkersSummary(conductorSessionId: string): Promise<{
  total: number;
  pending: number;
  running: number;
  waiting: number;
  completed: number;
  failed: number;
}> {
  const workers = await getWorkers(conductorSessionId);

  return {
    total: workers.length,
    pending: workers.filter(w => w.status === "pending").length,
    running: workers.filter(w => w.status === "running").length,
    waiting: workers.filter(w => w.status === "waiting").length,
    completed: workers.filter(w => w.status === "completed").length,
    failed: workers.filter(w => w.status === "failed" || w.status === "dead").length,
  };
}
