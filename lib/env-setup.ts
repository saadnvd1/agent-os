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
import { loadProjectConfig, projectEnv, withPorts } from "./project-config";
import { recordPlaced } from "./worktree-placed";

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
  // Dependency folders cloned from the main checkout.
  clonedDeps?: string[];
  packageManager?: string;
  ports?: Record<string, number>;
  durationMs: number;
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

const inside = (root: string, p: string) =>
  p === root || p.startsWith(root + path.sep);

// The real path of `p`'s deepest part that exists.
async function realExisting(p: string): Promise<string> {
  for (let at = p; ; at = path.dirname(at)) {
    const real = await fs.promises.realpath(at).catch(() => null);
    if (real) return real;
    if (path.dirname(at) === at) return at;
  }
}

/**
 * agentos.json's `copy`: files or folders from the main checkout, each one
 * resolved (symlinks included) to a place inside it, so a project can't
 * copy what lies outside itself into a worktree an agent may commit from.
 */
export async function copyDeclared(
  sourcePath: string,
  worktreePath: string,
  paths: string[]
): Promise<{ copied: string[]; refused: string[] }> {
  const root = await fs.promises.realpath(sourcePath);
  const target = await fs.promises.realpath(worktreePath);
  const copied: string[] = [];
  const refused: string[] = [];
  for (const rel of paths) {
    const real = await fs.promises
      .realpath(path.join(sourcePath, rel))
      .catch(() => null);
    // Not there in this checkout: nothing to copy, as with a missing .env.
    if (!real) continue;
    if (!inside(root, real)) {
      refused.push(rel);
      continue;
    }
    try {
      // The worktree is the branch's, so a symlink committed there could
      // point the copy outside it: the folder written into is resolved, and
      // a link in the file's own place is replaced, never written through.
      const dir = path.join(target, path.dirname(rel));
      // Checked before anything is created: the deepest folder already
      // there must be inside, and what's missing is made beneath it.
      if (!inside(target, await realExisting(dir))) {
        refused.push(rel);
        continue;
      }
      await fs.promises.mkdir(dir, { recursive: true });
      const realDir = await fs.promises.realpath(dir);
      if (!inside(target, realDir)) {
        refused.push(rel);
        continue;
      }
      const dest = path.join(realDir, path.basename(rel));
      const there = await fs.promises.lstat(dest).catch(() => null);
      if (there?.isSymbolicLink()) await fs.promises.unlink(dest);
      await fs.promises.cp(real, dest, { recursive: true, force: true });
      copied.push(rel);
    } catch (error) {
      console.error(`Failed to copy ${rel}:`, error);
      refused.push(rel);
    }
  }
  return { copied, refused };
}

/**
 * Run setup for a new worktree
 */
export async function setupWorktree(options: {
  worktreePath: string;
  sourcePath: string;
  // The session's ports (lib/ports.ts), exported to the setup commands.
  ports?: Record<string, number> | null;
  skipInstall?: boolean;
  progress?: SetupProgress;
}): Promise<SetupResult> {
  const { worktreePath, sourcePath, skipInstall, progress } = options;

  const started = Date.now();
  const result: SetupResult = {
    success: true,
    steps: [],
    envFilesCopied: [],
    ports: options.ports ?? undefined,
    durationMs: 0,
  };
  // Each step is reported as it finishes, for the chat's setup card.
  const push = result.steps.push.bind(result.steps);
  result.steps.push = (...steps: SetupStep[]) => {
    for (const step of steps) progress?.onStep?.(step);
    return push(...steps);
  };

  // 1. The project's config. A broken one is reported and nothing of it is
  // used: running an older file's setup instead would hide the mistake.
  const { config, source, error } = loadProjectConfig(sourcePath);
  if (error) {
    result.success = false;
    result.steps.push({
      name: `Read ${source}`,
      command: `read ${source}`,
      success: false,
      error,
    });
  }

  // 2. Copy env files, or exactly what the config's `copy` names
  progress?.onStage?.("env");
  if (config.copy) {
    const { copied, refused } = await copyDeclared(
      sourcePath,
      worktreePath,
      config.copy
    );
    result.envFilesCopied = copied;
    if (copied.length || refused.length)
      result.steps.push({
        name: "Copy files",
        command: `cp ${config.copy.join(" ")}`,
        success: refused.length === 0,
        output: copied.length ? `Copied: ${copied.join(", ")}` : undefined,
        error: refused.length
          ? `Not copied (outside the project, or failed): ${refused.join(", ")}`
          : undefined,
      });
    if (refused.length) result.success = false;
  } else {
    result.envFilesCopied = await copyEnvFiles(sourcePath, worktreePath);
    if (result.envFilesCopied.length > 0) {
      result.steps.push({
        name: "Copy env files",
        command: `cp ${result.envFilesCopied.join(" ")}`,
        success: true,
        output: `Copied: ${result.envFilesCopied.join(", ")}`,
      });
    }
  }

  // The project's env, the session's ports over it, then the paths.
  const envVars: Record<string, string> = {
    ...projectEnv(config, options.ports ?? null),
    ROOT_WORKTREE_PATH: sourcePath,
    WORKTREE_PATH: worktreePath,
  };

  // 3. Dependencies: always when `clone` is declared; otherwise only when
  // there are no setup commands, which used to replace them.
  if (config.clone || (!config.setup?.length && !skipInstall)) {
    progress?.onStage?.("deps");
    await bringDependencies(
      result,
      sourcePath,
      worktreePath,
      envVars,
      undefined,
      config.clone
    );
  }

  // 4. The config's setup commands
  if (config.setup && config.setup.length > 0) {
    progress?.onStage?.("script");
    for (const cmd of config.setup) {
      // The paths and ports are written in, as before; the project's env
      // values only ever reach the shell, never the setup log.
      const expandedCmd = withPorts(cmd, {
        ...(options.ports ?? {}),
        ROOT_WORKTREE_PATH: sourcePath,
        WORKTREE_PATH: worktreePath,
      });

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
  }

  // What setup put there on purpose doesn't keep the worktree once the
  // task is done (lib/done/worktree.ts).
  await recordPlaced(
    worktreePath,
    result.envFilesCopied,
    result.clonedDeps ?? []
  ).catch((error) => console.error("Recording setup files failed:", error));

  result.durationMs = Date.now() - started;
  return result;
}
