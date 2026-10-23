/**
 * Installing a worktree's dependencies when they can't be cloned: the
 * lockfile's own frozen install, and nothing else. A plain install would
 * resolve ranges to versions newer than the lockfile, so a lockfile that
 * disagrees with package.json fails setup and the agent is told.
 */

import * as fs from "fs";
import * as path from "path";
import { sessionPath } from "../agents/tool-path";

export interface PackageManager {
  name: "bun" | "pnpm" | "yarn" | "npm";
  install: string;
}

// Each install includes devDependencies: the agent needs typecheck, tests
// and the build, and AgentOS itself runs with NODE_ENV=production.
const BY_LOCKFILE: Array<{ file: string; pm: PackageManager }> = [
  {
    file: "bun.lock",
    pm: { name: "bun", install: "bun install --frozen-lockfile" },
  },
  {
    file: "bun.lockb",
    pm: { name: "bun", install: "bun install --frozen-lockfile" },
  },
  {
    file: "pnpm-lock.yaml",
    pm: {
      name: "pnpm",
      install: "pnpm install --frozen-lockfile --prod=false",
    },
  },
  {
    file: "yarn.lock",
    pm: {
      name: "yarn",
      install: "yarn install --frozen-lockfile --production=false",
    },
  },
  {
    file: "package-lock.json",
    pm: { name: "npm", install: "npm ci --include=dev" },
  },
];

export const LOCKFILES = BY_LOCKFILE.map((l) => l.file);

export function detectPackageManager(
  projectPath: string
): PackageManager | null {
  for (const { file, pm } of BY_LOCKFILE) {
    if (fs.existsSync(path.join(projectPath, file))) return pm;
  }
  if (fs.existsSync(path.join(projectPath, "package.json"))) {
    // No lockfile, so nothing to be frozen to.
    return { name: "npm", install: "npm install --include=dev" };
  }
  return null;
}

// pnpm may exist only as a corepack shim that was never enabled; the shell
// defines `pnpm` through corepack when the command is missing.
export function shellCommand(command: string): string {
  if (!command.startsWith("pnpm ")) return command;
  return `if ! command -v pnpm >/dev/null 2>&1; then pnpm() { COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm "$@"; }; fi; ${command}`;
}

// What setup commands run under: the server's environment without the
// settings that make an install skip devDependencies, on the PATH a session
// gets (version managers' shims first), so `bundle` isn't the system Ruby's.
export function setupEnv(
  base: NodeJS.ProcessEnv,
  extra: Record<string, string> = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, ...extra };
  if (!extra.PATH) env.PATH = sessionPath(base.PATH);
  for (const key of Object.keys(env)) {
    const k = key.toLowerCase();
    if (
      key === "NODE_ENV" ||
      k === "npm_config_production" ||
      k === "npm_config_omit" ||
      k === "yarn_production"
    ) {
      delete env[key];
    }
  }
  return env;
}
