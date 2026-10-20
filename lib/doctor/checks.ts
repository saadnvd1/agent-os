/**
 * Is this machine ready to run AgentOS? Node, git, tmux, ripgrep, lsof and at
 * least one agent CLI, each with what to do when it is not. Read-only: it runs
 * each tool's version and nothing else.
 */

import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { agentOsHome, liveCheckout } from "../dev-instance/liveServer";
import { probeAgents, type AgentProbe } from "../agents/probe";
import { getAllProviderDefinitions } from "../providers/registry";

// The oldest Node major AgentOS runs on; scripts/lib/prerequisites.sh must agree
// (lib/doctor/drift.test.ts fails when they don't).
export const MIN_NODE_MAJOR = 22;

const TOOL_MS = 5_000;
const CACHE_MS = 60 * 1000;

export type CheckStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  // The line to run, or what to do, when the check is not ok.
  fix?: string;
}

export type ExecFn = (
  file: string,
  args: string[],
  options: { timeout: number }
) => Promise<{ stdout: string; stderr: string }>;

export interface DoctorDeps {
  exec: ExecFn;
  probe: (fresh: boolean) => Promise<Record<string, AgentProbe>>;
  nodeVersion: string;
  cliLinks: () => DoctorCheck | null;
}

const defaultDeps: DoctorDeps = {
  exec: promisify(execFile) as ExecFn,
  probe: probeAgents,
  nodeVersion: process.versions.node,
  cliLinks: () => checkCliLinks(),
};

const INSTALL = {
  mac: "brew install",
  linux: "sudo apt-get install -y",
};
const installLine = (pkg: string) =>
  process.platform === "darwin"
    ? `${INSTALL.mac} ${pkg}`
    : `${INSTALL.linux} ${pkg}`;

interface Tool {
  id: string;
  label: string;
  bin: string;
  args: string[];
  pkg: string;
  // Missing is a fail for what AgentOS cannot run without, a warn otherwise.
  required: boolean;
  why: string;
}

const TOOLS: Tool[] = [
  {
    id: "git",
    label: "git",
    bin: "git",
    args: ["--version"],
    pkg: "git",
    required: true,
    why: "Sessions work in git worktrees.",
  },
  {
    id: "tmux",
    label: "tmux",
    bin: "tmux",
    args: ["-V"],
    pkg: "tmux",
    required: true,
    why: "Terminal sessions run inside tmux.",
  },
  {
    id: "ripgrep",
    label: "ripgrep",
    bin: "rg",
    args: ["--version"],
    pkg: "ripgrep",
    required: false,
    why: "File search is slower without it.",
  },
  {
    id: "lsof",
    label: "lsof",
    bin: "lsof",
    args: ["-v"],
    pkg: "lsof",
    required: false,
    why: "Finding what holds a port needs it.",
  },
];

const firstLine = (s: string) =>
  s
    .split("\n")
    .find((l) => l.trim())
    ?.trim();

export function checkNode(version: string): DoctorCheck {
  const major = Number.parseInt(version.split(".")[0], 10);
  const ok = major >= MIN_NODE_MAJOR;
  return {
    id: "node",
    label: "Node.js",
    status: ok ? "ok" : "fail",
    detail: ok
      ? `v${version}`
      : `v${version}; AgentOS needs ${MIN_NODE_MAJOR} or newer`,
    ...(ok
      ? {}
      : { fix: `Install Node.js ${MIN_NODE_MAJOR}+ from nodejs.org` }),
  };
}

async function checkTool(tool: Tool, exec: ExecFn): Promise<DoctorCheck> {
  const base = { id: tool.id, label: tool.label };
  try {
    const { stdout, stderr } = await exec(tool.bin, tool.args, {
      timeout: TOOL_MS,
    });
    return {
      ...base,
      status: "ok",
      detail: firstLine(`${stdout}\n${stderr}`) ?? "installed",
    };
  } catch (error) {
    const timedOut = (error as { killed?: boolean }).killed;
    // lsof -v exits non-zero on some builds while printing its version; a
    // tool that ran is installed, only one that could not start is missing.
    const e = error as { code?: unknown; stdout?: string; stderr?: string };
    const ran = typeof e.code === "number" && !timedOut;
    if (tool.id === "lsof" && ran)
      return { ...base, status: "ok", detail: "installed" };
    return {
      ...base,
      status: tool.required ? "fail" : "warn",
      detail: timedOut
        ? `${tool.bin} did not answer`
        : `Not found. ${tool.why}`,
      fix: installLine(tool.pkg),
    };
  }
}

export function checkAgents(probes: Record<string, AgentProbe>): DoctorCheck {
  const clis = getAllProviderDefinitions().filter((d) => d.cli);
  const names = new Map(clis.map((d) => [d.id, d.name]));
  // Providers without a CLI (a plain terminal) are always "installed".
  const found = Object.entries(probes).filter(
    ([id, p]) => names.has(id as never) && p.installed
  );
  const ready = found.filter(([, p]) => p.auth !== "needs-login");
  const list = (rows: typeof found) =>
    rows.map(([id]) => names.get(id as never) ?? id).join(", ");
  if (ready.length > 0)
    return {
      id: "agents",
      label: "Agent CLI",
      status: "ok",
      detail: `${list(ready)} ready`,
    };
  if (found.length > 0)
    return {
      id: "agents",
      label: "Agent CLI",
      status: "warn",
      detail: `${list(found)} installed but needs sign-in`,
      fix: "Sign in below",
    };
  return {
    id: "agents",
    label: "Agent CLI",
    status: "fail",
    detail: "No agent CLI installed",
    fix: "Install one below",
  };
}

const CLI_LINKS: Array<[string, string]> = [
  ["agent-os", "scripts/agent-os"],
  ["aos", "bin/aos"],
];

const real = (p: string) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
};

/**
 * Do the CLI links in ~/.local/bin run the checkout the live server runs from?
 * A link into an older clone runs an old `aos`. Null when there is no live
 * server record or no link to judge.
 */
export function checkCliLinks(
  binDir = process.env.AOS_BIN_DIR || path.join(os.homedir(), ".local/bin"),
  home = agentOsHome()
): DoctorCheck | null {
  const live = liveCheckout(home);
  if (!live) return null;
  const stale: string[] = [];
  let seen = 0;
  for (const [name, rel] of CLI_LINKS) {
    const link = path.join(binDir, name);
    let target: string;
    try {
      target = fs.readlinkSync(link);
    } catch {
      continue;
    }
    seen++;
    const want = real(path.join(live, rel));
    if (!want || real(path.resolve(binDir, target)) !== want)
      stale.push(`${name} -> ${target}`);
  }
  if (seen === 0) return null;
  if (stale.length === 0)
    return {
      id: "cli-links",
      label: "CLI links",
      status: "ok",
      detail: `Point at ${live}`,
    };
  return {
    id: "cli-links",
    label: "CLI links",
    status: "warn",
    detail: `${stale.join(", ")}; the live server runs from ${live}`,
    fix: `${live}/scripts/sync-cli-links`,
  };
}

let cache: { at: number; checks: Promise<DoctorCheck[]> } | null = null;

/** Every check, in parallel, cached for a minute. `fresh` runs them again. */
export function runDoctor(
  fresh = false,
  deps: Partial<DoctorDeps> = {}
): Promise<DoctorCheck[]> {
  const custom = Object.keys(deps).length > 0;
  if (!custom && !fresh && cache && Date.now() - cache.at < CACHE_MS)
    return cache.checks;
  const d = { ...defaultDeps, ...deps };
  const checks = Promise.all([
    Promise.resolve(checkNode(d.nodeVersion)),
    ...TOOLS.map((t) => checkTool(t, d.exec)),
    d
      .probe(fresh)
      .then(checkAgents)
      .catch((): DoctorCheck => ({
        id: "agents",
        label: "Agent CLI",
        status: "warn",
        detail: "Couldn't check the agent CLIs",
        fix: "Check again",
      })),
    Promise.resolve(d.cliLinks()),
  ]).then((all) => all.filter((c): c is DoctorCheck => c !== null));
  if (!custom) cache = { at: Date.now(), checks };
  return checks;
}
