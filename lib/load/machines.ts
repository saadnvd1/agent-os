/**
 * What the scheduler knows about a machine when it decides to start a task
 * there: how loaded it is (sampled by the monitor every 10s, or polled from a
 * linked machine every 15s), whether it has been calm long enough, how many
 * simulators are booted, and when it last started something. Nothing here
 * samples anything itself: the load is the thing being protected.
 */

import os from "os";
import { bootedCount, maxBooted } from "../simulator/lease";
import { simulatorAvailable } from "../simulator/available";
import { currentLevel, loadEnabled } from "./monitor";
import type { LoadLevel } from "./level";
import type { MachineLevel, MachineView } from "../tasks/schedule";
import { HEAVY_BOOT_MS, LOCAL, gateOf, startsBy } from "./start-gate";

export {
  HEAVY_BOOT_MS,
  LOCAL,
  StartGate,
  feedGate,
  recordAutoStart,
  resetMachineStarts,
} from "./start-gate";

// Development only: pin the level so the holds can be shown without loading
// the machine.
function overrideLevel(): MachineLevel | null {
  if (process.env.NODE_ENV !== "development") return null;
  const v = process.env.AGENTOS_LOAD_LEVEL;
  return v === "red" || v === "amber" || v === "green" ? v : null;
}

export interface LocalFacts {
  level: LoadLevel | null;
  load1: number;
  cores: number;
  memUsedPct: number;
  booted: number;
  capabilities: string[];
}

// What this machine can run. Only a Mac with Xcode's tools gives a simulator.
export function machineCapabilities(): string[] {
  if (process.platform !== "darwin") return [process.platform];
  return simulatorAvailable() ? ["mac", "xcode", "simulator"] : ["mac"];
}

export function localFacts(): LocalFacts {
  const cores = os.cpus().length || 1;
  const total = os.totalmem();
  return {
    level: overrideLevel() ?? currentLevel(),
    load1: Math.round(os.loadavg()[0] * 10) / 10,
    cores,
    memUsedPct: Math.round(((total - os.freemem()) / total) * 100),
    booted: bootedCount(),
    capabilities: machineCapabilities(),
  };
}

export interface MachineSource {
  hostId: string;
  label: string;
  level: LoadLevel | null;
  booted: number;
  maxBooted: number;
  capabilities: string[];
  // A peer whose reading is missing or older than the stale limit.
  stale?: boolean;
}

// The scheduler's view of a machine, from its readings and the start
// bookkeeping. Pure given those.
export function viewOf(src: MachineSource, now: number): MachineView {
  const gate = gateOf(src.hostId).view(now, src.level);
  const s = startsBy.get(src.hostId);
  const level: MachineLevel = src.stale ? "red" : (src.level ?? "green");
  return {
    label: src.label,
    enabled: src.hostId !== LOCAL || loadEnabled(),
    reading: src.stale ? false : gate.reading && src.level === null,
    level,
    settled: src.stale ? false : gate.settled,
    settleLeftMs: gate.settleLeftMs,
    booted: src.booted,
    maxBooted: src.maxBooted,
    heavyStarting: (s?.heavy ?? []).filter((t) => now - t < HEAVY_BOOT_MS)
      .length,
    lastAutoStartAt: s?.auto ?? null,
    lastHeavyStartAt: s?.heavy.length ? Math.max(...s.heavy) : null,
  };
}

export function localView(now = Date.now()): MachineView {
  const facts = localFacts();
  const over = overrideLevel();
  if (over) {
    // The pinned level counts as long observed: calm unless red.
    const view = viewOf(
      {
        hostId: LOCAL,
        label: "this machine",
        level: over,
        booted: facts.booted,
        maxBooted: maxBooted(),
        capabilities: facts.capabilities,
      },
      now
    );
    return { ...view, reading: false, settled: over !== "red" };
  }
  return viewOf(
    {
      hostId: LOCAL,
      label: "this machine",
      level: facts.level,
      booted: facts.booted,
      maxBooted: maxBooted(),
      capabilities: facts.capabilities,
    },
    now
  );
}
