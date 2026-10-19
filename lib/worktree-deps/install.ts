/**
 * Installing a worktree's dependencies when they can't be cloned: the
 * lockfile's own frozen install first. A project other than AgentOS then
 * gets a plain install, with a warning; AgentOS's own never does, because a
 * plain install resolves ranges to versions newer than the lockfile.
 */

import * as fs from "fs";
import * as path from "path";

export interface PackageManager {
  name: "bun" | "pnpm" | "yarn" | "npm";
  // Tried in order until one succeeds: frozen to the lockfile, then plain.
  installs: string[];
  // Set when the frozen install is the only one tried (AgentOS's own).
  frozenOnly?: boolean;
}

const AGENTOS_PACKAGE = "@saadnvd1/agent-os";

// Each install includes devDependencies: the agent needs typecheck, tests
// and the build, and AgentOS itself runs with NODE_ENV=production.
const BY_LOCKFILE: Array<{ file: string; pm: PackageManager }> = [
  {
    file: "bun.lock",
    pm: {
      name: "bun",
      installs: ["bun install --frozen-lockfile", "bun install"],
    },
  },
  {
    file: "bun.lockb",
    pm: {
      name: "bun",
      installs: ["bun install --frozen-lockfile", "bun install"],
    },
  },
  {
    file: "pnpm-lock.yaml",
    pm: {
      name: "pnpm",
      installs: [
        "pnpm install --frozen-lockfile --prod=false",
        "pnpm install --prod=false",
      ],
    },
  },
  {
    file: "yarn.lock",
    pm: {
      name: "yarn",
      installs: [
        "yarn install --frozen-lockfile --production=false",
        "yarn install --production=false",
      ],
    },
  },
  {
    file: "package-lock.json",
    pm: {
      name: "npm",
      installs: ["npm ci --include=dev", "npm install --include=dev"],
    },
  },
];

export const LOCKFILES = BY_LOCKFILE.map((l) => l.file);

function isAgentOs(projectPath: string): boolean {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(projectPath, "package.json"), "utf-8")
    );
    return pkg?.name === AGENTOS_PACKAGE;
  } catch {
    return false;
  }
}

export function detectPackageManager(
  projectPath: string
): PackageManager | null {
  for (const { file, pm } of BY_LOCKFILE) {
    if (!fs.existsSync(path.join(projectPath, file))) continue;
    return isAgentOs(projectPath)
      ? { ...pm, installs: pm.installs.slice(0, 1), frozenOnly: true }
      : pm;
  }
  if (fs.existsSync(path.join(projectPath, "package.json"))) {
    // No lockfile, so nothing to be frozen to.
    return { name: "npm", installs: ["npm install --include=dev"] };
  }
  return null;
}

// pnpm may exist only as a corepack shim that was never enabled; the shell
// defines `pnpm` through corepack when the command is missing.
export function shellCommand(command: string): string {
  if (!command.startsWith("pnpm ")) return command;
  return `if ! command -v pnpm >/dev/null 2>&1; then pnpm() { COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm "$@"; }; fi; ${command}`;
}

export const UNFROZEN_WARNING =
  "The lockfile is out of sync with package.json, so dependencies were installed without it. Commit the updated lockfile.";

// What setup commands run under: the server's environment without the
// settings that make an install skip devDependencies.
export function setupEnv(
  base: NodeJS.ProcessEnv,
  extra: Record<string, string> = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, ...extra };
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
