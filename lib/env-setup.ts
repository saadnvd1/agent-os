/**
 * Environment Setup for Worktrees
 *
 * Handles copying env files, installing dependencies, and running setup scripts
 * when creating new worktrees.
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";

const execAsync = promisify(exec);

export interface WorktreeConfig {
  setup?: string[];
  devServer?: {
    command: string;
    portEnvVar?: string;
  };
}

export interface SetupResult {
  success: boolean;
  steps: Array<{
    name: string;
    command: string;
    success: boolean;
    output?: string;
    error?: string;
  }>;
  envFilesCopied: string[];
  packageManager?: string;
  port?: number;
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
 * Detect package manager from lockfiles
 */
export function detectPackageManager(projectPath: string): {
  name: string;
  installCommand: string;
} | null {
  const lockfiles = [
    { file: "bun.lockb", name: "bun", command: "bun install" },
    { file: "pnpm-lock.yaml", name: "pnpm", command: "pnpm install" },
    { file: "yarn.lock", name: "yarn", command: "yarn install" },
    { file: "package-lock.json", name: "npm", command: "npm install" },
  ];

  for (const { file, name, command } of lockfiles) {
    if (fs.existsSync(path.join(projectPath, file))) {
      return { name, installCommand: command };
    }
  }

  // Fallback: check if package.json exists
  if (fs.existsSync(path.join(projectPath, "package.json"))) {
    return { name: "npm", installCommand: "npm install" };
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
 * Run a setup command in the worktree directory
 */
async function runCommand(
  command: string,
  cwd: string,
  env: Record<string, string> = {}
): Promise<{ success: boolean; output: string; error?: string }> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: 300000, // 5 minutes
      env: { ...process.env, ...env },
    });
    return {
      success: true,
      output: stdout + (stderr ? `\n${stderr}` : ""),
    };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    return {
      success: false,
      output: err.stdout || "",
      error: err.stderr || err.message || "Unknown error",
    };
  }
}

/**
 * Run setup for a new worktree
 */
export async function setupWorktree(options: {
  worktreePath: string;
  sourcePath: string;
  port?: number;
  skipInstall?: boolean;
}): Promise<SetupResult> {
  const { worktreePath, sourcePath, port, skipInstall } = options;

  const result: SetupResult = {
    success: true,
    steps: [],
    envFilesCopied: [],
    port,
  };

  // 1. Read config if exists
  const config = await readWorktreeConfig(sourcePath);

  // 2. Copy env files
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
    // 4. Auto-detect and install dependencies
    const pm = detectPackageManager(sourcePath);
    if (pm) {
      result.packageManager = pm.name;
      const installResult = await runCommand(
        pm.installCommand,
        worktreePath,
        envVars
      );
      result.steps.push({
        name: `Install dependencies (${pm.name})`,
        command: pm.installCommand,
        success: installResult.success,
        output: installResult.output,
        error: installResult.error,
      });

      if (!installResult.success) {
        result.success = false;
      }
    }
  }

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
