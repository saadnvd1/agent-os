// Pressure as the OS sees it: macOS's memory level, or Linux PSI (memory
// and CPU, whichever is worse).
// Unknown (null) when neither is there; the load average still decides.
import { execFile } from "child_process";
import { readFile } from "fs/promises";
import type { Pressure } from "./level";

// kern.memorystatus_vm_pressure_level: 1 normal, 2 warn, 4 critical.
export function parseDarwinPressure(out: string): Pressure {
  const n = Number(out.trim());
  if (n === 4) return "critical";
  if (n === 2) return "warn";
  if (n === 1) return "normal";
  return null;
}

// /proc/pressure/memory: "some avg10=…" is time anything stalled on memory,
// "full avg10=…" time everything did.
export function parsePsiPressure(text: string): Pressure {
  const avg10 = (kind: string) => {
    const m = new RegExp(`^${kind} avg10=([\\d.]+)`, "m").exec(text);
    return m ? Number(m[1]) : null;
  };
  const some = avg10("some");
  const full = avg10("full");
  if (some === null && full === null) return null;
  if ((full ?? 0) >= 5) return "critical";
  if ((some ?? 0) >= 10) return "warn";
  return "normal";
}

// /proc/pressure/cpu: share of time something waited for a CPU.
export function parseCpuPsi(text: string): Pressure {
  const m = /^some avg10=([\d.]+)/m.exec(text);
  if (!m) return null;
  const some = Number(m[1]);
  return some >= 90 ? "critical" : some >= 60 ? "warn" : "normal";
}

const RANK = { normal: 1, warn: 2, critical: 3 } as const;
export const worse = (a: Pressure, b: Pressure): Pressure =>
  !a ? b : !b ? a : RANK[a] >= RANK[b] ? a : b;

const readOr = (file: string, parse: (t: string) => Pressure) =>
  readFile(file, "utf8").then(parse, () => null);

export function readPressure(timeoutMs = 2000): Promise<Pressure> {
  if (process.platform === "darwin")
    return new Promise((resolve) =>
      execFile(
        "sysctl",
        ["-n", "kern.memorystatus_vm_pressure_level"],
        { timeout: timeoutMs },
        (err, stdout) => resolve(err ? null : parseDarwinPressure(stdout))
      )
    );
  if (process.platform === "linux")
    return Promise.all([
      readOr("/proc/pressure/memory", parsePsiPressure),
      readOr("/proc/pressure/cpu", parseCpuPsi),
    ]).then(([memory, cpu]) => worse(memory, cpu));
  return Promise.resolve(null);
}
