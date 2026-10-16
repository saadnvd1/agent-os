import fs from "fs";
import { execFileSync } from "child_process";

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

const real = (p: string): string => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

export function processCwd(pid: number): string | null {
  try {
    if (process.platform === "linux")
      return real(fs.readlinkSync(`/proc/${pid}/cwd`));
    const out = execFileSync(
      "lsof",
      ["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }
    );
    const line = out.split("\n").find((l) => l.startsWith("n"));
    return line ? real(line.slice(1)) : null;
  } catch {
    return null;
  }
}

// Whether the process was launched as the live server: its environment
// carries the marker, or its title is the server's.
export function looksLive(pid: number): boolean {
  try {
    if (process.platform === "linux") {
      const env = fs.readFileSync(`/proc/${pid}/environ`, "utf8").split("\0");
      if (env.includes("AGENTOS_SERVER=live")) return true;
    } else {
      const out = execFileSync(
        "ps",
        ["eww", "-p", String(pid), "-o", "command="],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }
      );
      if (/\bAGENTOS_SERVER=live\b/.test(out)) return true;
    }
    const comm = execFileSync("ps", ["-p", String(pid), "-o", "comm="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return comm.trim() === "agentos-server";
  } catch {
    return false;
  }
}

export const samePath = (a: string, b: string): boolean => real(a) === real(b);
