// Memory pressure as the OS sees it: macOS's own level, or Linux PSI.
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
    return readFile("/proc/pressure/memory", "utf8").then(
      parsePsiPressure,
      () => null
    );
  return Promise.resolve(null);
}
