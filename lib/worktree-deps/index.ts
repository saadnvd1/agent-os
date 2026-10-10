/**
 * A worktree's dependencies and setup commands: clone from the main
 * checkout when it can, install when it can't.
 */

import { exec } from "child_process";
import { promisify } from "util";
import type { SetupResult } from "../env-setup";
import { NOT_MAC, cloneDeps } from "./clone";
import { detectPackageManager, setupEnv } from "./install";

const execAsync = promisify(exec);

/**
 * Run a setup command in the worktree directory
 */
export async function runCommand(
  command: string,
  cwd: string,
  env: Record<string, string> = {}
): Promise<{ success: boolean; output: string; error?: string }> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: 300000, // 5 minutes
      env: setupEnv(process.env, env),
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
 * Clone the main checkout's node_modules (or exactly agentos.json's `clone`
 * paths), or else install: the lockfile's frozen install first, then a
 * plain one.
 */
export async function bringDependencies(
  result: SetupResult,
  sourcePath: string,
  worktreePath: string,
  envVars: Record<string, string>,
  deps = { run: runCommand, clone: cloneDeps },
  only?: string[]
): Promise<void> {
  const pm = detectPackageManager(worktreePath);
  if (!pm && !only?.length) return;
  if (pm) result.packageManager = pm.name;

  const clone = await deps.clone({ sourcePath, worktreePath, only });
  // Off macOS only node_modules has a fallback (the install below).
  if (!pm && !clone.ok && !clone.cloned.length && clone.reason === NOT_MAC)
    return;
  if (clone.ok || !pm) {
    result.steps.push({
      name: "Clone dependencies",
      command: "cp -Rc",
      success: clone.ok,
      output: clone.cloned.map((c) => `${c.rel} (${c.from})`).join(", "),
      error: clone.ok ? undefined : clone.reason,
    });
    if (!clone.ok) result.success = false;
    return;
  }

  let error: string | undefined;
  for (const command of pm.installs) {
    const run = await deps.run(command, worktreePath, envVars);
    result.steps.push({
      name: `Install dependencies (${pm.name})`,
      command,
      success: run.success,
      output: [clone.reason && `Not cloned: ${clone.reason}`, run.output]
        .filter(Boolean)
        .join("\n"),
      error: run.error,
    });
    if (run.success) return;
    error = run.error;
  }
  if (error !== undefined) result.success = false;
}
