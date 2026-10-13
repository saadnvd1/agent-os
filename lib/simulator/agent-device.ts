/**
 * Driving a simulator: the `agent-device` CLI (an XCTest runner behind an
 * accessibility-tree snapshot with element refs), pinned and installed on
 * first use. The task never names a device or session: they are injected
 * here, so it can only drive its own simulator.
 */

import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const AGENT_DEVICE_VERSION = "0.21.27";

const root = () => path.join(os.homedir(), ".agent-os");
export const toolDir = () =>
  path.join(root(), "tools", `agent-device-${AGENT_DEVICE_VERSION}`);
export const toolBin = () =>
  path.join(toolDir(), "node_modules/.bin/agent-device");
// Its daemon, device claims and XCTest runner cache stay apart from any other
// copy of the tool on this Mac.
export const stateDir = () => path.join(root(), "agent-device");
export const simulatorDir = (sessionId: string) =>
  path.join(root(), "simulators", sessionId);
export const shotsDir = (sessionId: string) =>
  path.join(simulatorDir(sessionId), "shots");

export const ALLOWED = new Set([
  "snapshot",
  "click",
  "press",
  "longpress",
  "fill",
  "type",
  "scroll",
  "swipe",
  "back",
  "home",
  "find",
  "get",
  "wait",
  "screenshot",
  "apps",
  "relaunch",
]);

// Flags that pick a device, a session or where the tool keeps its state.
const REFUSED = new Set([
  "--udid",
  "--device",
  "--serial",
  "--session",
  "--state-dir",
  "--platform",
  "--ios-simulator-device-set",
  "--ios-xctest-derived-data-path",
]);

export interface Target {
  udid: string;
  sessionId: string;
  app?: string | null;
}

// The tool's session on the task's device, attached to the app.
export function openArgs(target: Target): string[] {
  return [
    "open",
    target.app ?? "",
    "--platform",
    "ios",
    "--udid",
    target.udid,
    "--session",
    agentSession(target.sessionId),
  ];
}

export const agentSession = (sessionId: string) =>
  `aos-${sessionId.replace(/-/g, "").slice(0, 8)}`;

// The argv for one call, or why it is refused.
export function buildArgs(
  args: string[],
  target: Target,
  now = () => Date.now()
): string[] {
  const [sub, ...rest] = args;
  if (!sub || !ALLOWED.has(sub))
    throw new Error(
      `aos sim ${sub ?? ""}: not allowed. Use: ${[...ALLOWED].join(", ")}`
    );
  for (const a of rest) {
    const flag = a.split("=")[0];
    if (REFUSED.has(flag))
      throw new Error(
        `${flag} is set for you: the simulator is this task's own`
      );
  }
  // `aos sim open` is AgentOS's own; the tool's `open` is how a session is
  // attached to the app, which bring-up does and `relaunch` repeats.
  const out =
    sub === "relaunch"
      ? ["open", ...(target.app ? [target.app] : []), "--relaunch", ...rest]
      : [sub, ...rest];
  if (sub === "screenshot" && !rest.some((a) => !a.startsWith("-")))
    out.push(path.join(shotsDir(target.sessionId), `${now()}.png`));
  return [
    ...out,
    "--platform",
    "ios",
    "--udid",
    target.udid,
    "--session",
    agentSession(target.sessionId),
  ];
}

// The screenshot path a built argv will write, if it is one.
export const screenshotPath = (argv: string[]): string | null =>
  argv[0] === "screenshot"
    ? (argv.slice(1).find((a) => !a.startsWith("-")) ?? null)
    : null;

export const toolEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  AGENT_DEVICE_STATE_DIR: stateDir(),
});

let installing: Promise<void> | null = null;

export function ensureInstalled(): Promise<void> {
  if (fs.existsSync(toolBin())) return Promise.resolve();
  installing ??= (async () => {
    fs.mkdirSync(toolDir(), { recursive: true });
    await execFileAsync(
      "npm",
      [
        "install",
        "--prefix",
        toolDir(),
        "--no-audit",
        "--no-fund",
        `agent-device@${AGENT_DEVICE_VERSION}`,
      ],
      { timeout: 300_000 }
    );
  })().finally(() => {
    installing = null;
  });
  return installing;
}

export interface CallResult {
  stdout: string;
  stderr: string;
  code: number;
}

export async function callTool(
  argv: string[],
  timeoutMs = 120_000
): Promise<CallResult> {
  await ensureInstalled();
  fs.mkdirSync(stateDir(), { recursive: true });
  try {
    const { stdout, stderr } = await execFileAsync(toolBin(), argv, {
      env: toolEnv(),
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const e = error as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      message: string;
    };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr || e.message,
      code: typeof e.code === "number" ? e.code : 1,
    };
  }
}
