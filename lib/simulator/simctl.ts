/**
 * The iOS simulators AgentOS makes for tasks, through `xcrun simctl`. Every
 * device is named with this instance's prefix, and nothing destructive is
 * ever done to a device without it: a project's own simulators and another
 * AgentOS instance's (a dev one, say) are never touched.
 */

import { execFile } from "child_process";
import { createHash } from "crypto";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface SimDevice {
  udid: string;
  name: string;
  state: string;
  runtime: string;
}

export type SimctlRun = (args: string[]) => Promise<string>;

const realRun: SimctlRun = async (args) =>
  (
    await execFileAsync("xcrun", ["simctl", ...args], {
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
    })
  ).stdout.trim();

let run: SimctlRun = realRun;
// Tests swap simctl for a fake; nothing else calls this.
export function setSimctlRunner(fake: SimctlRun | null): void {
  run = fake ?? realRun;
}

// Short and stable per database, so two instances on one Mac stay apart.
export function instancePrefix(): string {
  const db = process.env.DB_PATH || path.join(process.cwd(), "agent-os.db");
  return `aos-${createHash("sha1").update(db).digest("hex").slice(0, 6)}-`;
}

export const baseName = () => `${instancePrefix()}base`;
export const deviceNameFor = (sessionId: string) =>
  `${instancePrefix()}${sessionId.replace(/-/g, "").slice(0, 8)}`;
export const ownsDevice = (name: string) => name.startsWith(instancePrefix());

export function parseDevices(json: string): SimDevice[] {
  const parsed = JSON.parse(json) as {
    devices?: Record<
      string,
      { udid: string; name: string; state: string; isAvailable?: boolean }[]
    >;
  };
  return Object.entries(parsed.devices ?? {}).flatMap(([runtime, list]) =>
    list
      .filter((d) => d.isAvailable !== false)
      .map((d) => ({
        udid: d.udid,
        name: d.name,
        state: d.state,
        runtime,
      }))
  );
}

export async function listDevices(): Promise<SimDevice[]> {
  return parseDevices(await run(["list", "devices", "-j"]));
}

// The newest installed iOS runtime and the device type for a model name
// ("iPhone 17" is com.apple.CoreSimulator.SimDeviceType.iPhone-17).
async function newestRuntime(): Promise<string> {
  const parsed = JSON.parse(await run(["list", "runtimes", "-j"])) as {
    runtimes: { identifier: string; name: string; isAvailable: boolean }[];
  };
  const ios = parsed.runtimes.filter(
    (r) => r.isAvailable && r.name.startsWith("iOS")
  );
  const newest = ios.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  )[ios.length - 1];
  if (!newest) throw new Error("no iOS simulator runtime is installed");
  return newest.identifier;
}

export const deviceTypeFor = (model: string) =>
  `com.apple.CoreSimulator.SimDeviceType.${model.trim().replace(/\s+/g, "-")}`;

let baseBuilding: Promise<SimDevice> | null = null;

// The device every task's simulator is cloned from: made once, booted once so
// its first-run setup is done, then left shut down.
export function ensureBase(model: string): Promise<SimDevice> {
  baseBuilding ??= buildBase(model).finally(() => {
    baseBuilding = null;
  });
  return baseBuilding;
}

async function buildBase(model: string): Promise<SimDevice> {
  const runtime = await newestRuntime();
  const existing = (await listDevices()).find(
    (d) => d.name === baseName() && d.runtime === runtime
  );
  if (existing) return existing;
  // A base on an older runtime is replaced; its clones keep working.
  for (const d of (await listDevices()).filter((d) => d.name === baseName()))
    await deleteDevice(d);
  const udid = await run(["create", baseName(), deviceTypeFor(model), runtime]);
  await run(["boot", udid]);
  await run(["bootstatus", udid, "-b"]);
  await run(["shutdown", udid]);
  return { udid, name: baseName(), state: "Shutdown", runtime };
}

export async function cloneDevice(base: SimDevice, name: string) {
  if (!ownsDevice(name)) throw new Error(`refusing to create ${name}`);
  return run(["clone", base.udid, name]);
}

export async function bootDevice(udid: string): Promise<void> {
  try {
    await run(["boot", udid]);
  } catch (error) {
    // Booting a booted device is not a failure.
    if (!/current state: Booted/i.test(String(error))) throw error;
  }
  await run(["bootstatus", udid, "-b"]);
}

export async function shutdownDevice(device: {
  udid: string;
  name: string;
}): Promise<void> {
  if (!ownsDevice(device.name)) return;
  try {
    await run(["shutdown", device.udid]);
  } catch (error) {
    if (!/current state: Shutdown/i.test(String(error))) throw error;
  }
}

export async function deleteDevice(device: {
  udid: string;
  name: string;
}): Promise<void> {
  if (!ownsDevice(device.name)) return;
  await shutdownDevice(device).catch(() => {});
  await run(["delete", device.udid]);
}

// What the device's app logged lately, newest last.
export const recentLog = (udid: string, process: string, last: string) =>
  run([
    "spawn",
    udid,
    "log",
    "show",
    "--last",
    last,
    "--predicate",
    `process == "${process.replace(/[^\w .-]/g, "")}"`,
    "--style",
    "compact",
  ]);
