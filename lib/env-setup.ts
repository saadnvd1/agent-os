/**
 * Environment Setup for Worktrees
 *
 * Handles copying env files, bringing dependencies (cloned from the main
 * checkout when it can, installed when it can't), and running setup scripts
 * when creating new worktrees.
 */

import * as fs from "fs";
import * as path from "path";
import { bringDependencies, runCommand } from "./worktree-deps";

export interface WorktreeConfig {
  setup?: string[];
  devServer?: {
    command: string;
    portEnvVar?: string;
  };
}

export interface SetupStep {
  name: string;
  command: string;
  success: boolean;
  output?: string;
  error?: string;
}

// The stages a worktree's setup goes through, in order, for progress.
export type SetupStage = "env" | "deps" | "script";

export interface SetupProgress {
  onStage?: (stage: SetupStage) => void;
  onStep?: (step: SetupStep) => void;
}

export interface SetupResult {
  success: boolean;
  steps: SetupStep[];
  envFilesCopied: string[];
  packageManager?: string;
  port?: number;
  durationMs: number;
}

/**
 * Read worktree config from project
 */
export async function readWorktreeConfig(
  projectPath: string
): Promise<WorktreeConfig | null> {
  const configPaths = [
    path.join(projectPath, ".agent-os", "worktrees.json"),
    path.join(projectPath, ".agent-os.json"),
  ];

  for (const configPath of configPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const content = await fs.promises.readFile(configPath, "utf-8");
        return JSON.parse(content);
      }
    } catch {
      // Continue to next path
    }
  }

  return null;
}

/**
 * Find env files to copy (excludes .env.example)
 */
export function findEnvFiles(projectPath: string): string[] {
  try {
    const files = fs.readdirSync(projectPath);
    return files.filter(
      (f) =>
        f.startsWith(".env") &&
        !f.endsWith(".example") &&
        fs.statSync(path.join(projectPath, f)).isFile()
    );
  } catch {
    return [];
  }
}

/**
 * Copy env files from source to worktree
 */
export async function copyEnvFiles(
  sourcePath: string,
  worktreePath: string
): Promise<string[]> {
  const envFiles = findEnvFiles(sourcePath);
  const copied: string[] = [];

  for (const file of envFiles) {
    try {
      const src = path.join(sourcePath, file);
      const dest = path.join(worktreePath, file);
      await fs.promises.copyFile(src, dest);
      copied.push(file);
    } catch (error) {
      console.error(`Failed to copy ${file}:`, error);
    }
  }

  return copied;
}

/**
 * Run setup for a new worktree
 */
export async function setupWorktree(options: {
  worktreePath: string;
  sourcePath: string;
  port?: number;
  skipInstall?: boolean;
  progress?: SetupProgress;
}): Promise<SetupResult> {
  const { worktreePath, sourcePath, port, skipInstall, progress } = options;

  const started = Date.now();
  const result: SetupResult = {
    success: true,
    steps: [],
    envFilesCopied: [],
    port,
    durationMs: 0,
  };
  // Each step is reported as it finishes, for the chat's setup card.
  const push = result.steps.push.bind(result.steps);
  result.steps.push = (...steps: SetupStep[]) => {
    for (const step of steps) progress?.onStep?.(step);
    return push(...steps);
  };

  // 1. Read config if exists
  const config = await readWorktreeConfig(sourcePath);

  // 2. Copy env files
  progress?.onStage?.("env");
  result.envFilesCopied = await copyEnvFiles(sourcePath, worktreePath);
  if (result.envFilesCopied.length > 0) {
    result.steps.push({
      name: "Copy env files",
      command: `cp ${result.envFilesCopied.join(" ")}`,
      success: true,
      output: `Copied: ${result.envFilesCopied.join(", ")}`,
    });
  }

  // Build env vars for commands
  const envVars: Record<string, string> = {
    ROOT_WORKTREE_PATH: sourcePath,
    WORKTREE_PATH: worktreePath,
  };
  if (port) {
    envVars.PORT = String(port);
  }

  // 3. Run config setup commands if present
  if (config?.setup && config.setup.length > 0) {
    progress?.onStage?.("script");
    for (const cmd of config.setup) {
      // Expand variables in command
      let expandedCmd = cmd;
      for (const [key, value] of Object.entries(envVars)) {
        expandedCmd = expandedCmd.replace(new RegExp(`\\$${key}`, "g"), value);
      }

      const cmdResult = await runCommand(expandedCmd, worktreePath, envVars);
      result.steps.push({
        name: `Config: ${cmd.slice(0, 50)}${cmd.length > 50 ? "..." : ""}`,
        command: expandedCmd,
        success: cmdResult.success,
        output: cmdResult.output,
        error: cmdResult.error,
      });

      if (!cmdResult.success) {
        result.success = false;
      }
    }
  } else if (!skipInstall) {
    progress?.onStage?.("deps");
    await bringDependencies(result, sourcePath, worktreePath, envVars);
  }

  result.durationMs = Date.now() - started;
  return result;
}

/**
 * Get dev server command from config or package.json
 */
export async function getDevServerCommand(
  projectPath: string,
  port?: number
): Promise<{ command: string; port: number } | null> {
  // Check config first
  const config = await readWorktreeConfig(projectPath);
  if (config?.devServer) {
    const portEnvVar = config.devServer.portEnvVar || "PORT";
    const finalPort = port || 3000;
    return {
      command: `${portEnvVar}=${finalPort} ${config.devServer.command}`,
      port: finalPort,
    };
  }

  // Check package.json for dev script
  const pkgPath = path.join(projectPath, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await fs.promises.readFile(pkgPath, "utf-8"));
      if (pkg.scripts?.dev) {
        const finalPort = port || 3000;
        return {
          command: `PORT=${finalPort} npm run dev`,
          port: finalPort,
        };
      }
    } catch {
      // Ignore parse errors
    }
  }

  return null;
}
