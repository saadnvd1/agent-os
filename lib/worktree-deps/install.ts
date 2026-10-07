/**
 * Installing a worktree's dependencies when they can't be cloned: the
 * lockfile's own frozen install first, then a plain install.
 */

import * as fs from "fs";
import * as path from "path";

export interface PackageManager {
  name: "bun" | "pnpm" | "yarn" | "npm";
  // Tried in order until one succeeds: frozen to the lockfile, then plain.
  installs: string[];
}

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

export function detectPackageManager(
  projectPath: string
): PackageManager | null {
  for (const { file, pm } of BY_LOCKFILE) {
    if (fs.existsSync(path.join(projectPath, file))) return pm;
  }
  if (fs.existsSync(path.join(projectPath, "package.json"))) {
    // No lockfile, so nothing to be frozen to.
    return { name: "npm", installs: ["npm install --include=dev"] };
  }
  return null;
}

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
