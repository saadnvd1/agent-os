import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// These run inside the server (task end, the sweep), so none may block the
// event loop or hang: a timeout reads as "could not verify".
export const PROBE_TIMEOUT_MS = 3000;

export class ProbeTimeout extends Error {}

export async function probe(cmd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      encoding: "utf8",
      timeout: PROBE_TIMEOUT_MS,
    });
    return stdout;
  } catch (e) {
    if ((e as { killed?: boolean }).killed) throw new ProbeTimeout(cmd);
    throw e;
  }
}

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

export async function processCwd(pid: number): Promise<string | null> {
  try {
    if (process.platform === "linux")
      return real(fs.readlinkSync(`/proc/${pid}/cwd`));
    const out = await probe("lsof", [
      "-a",
      "-p",
      String(pid),
      "-d",
      "cwd",
      "-Fn",
    ]);
    const line = out.split("\n").find((l) => l.startsWith("n"));
    return line ? real(line.slice(1)) : null;
  } catch {
    return null;
  }
}

// Whether the process was launched as the live server: its environment
// carries the marker, or its title is the server's. A probe that times out
// answers true: not being able to tell is a reason to leave it alone.
export async function looksLive(pid: number): Promise<boolean> {
  try {
    if (process.platform === "linux") {
      const env = fs.readFileSync(`/proc/${pid}/environ`, "utf8").split("\0");
      if (env.includes("AGENTOS_SERVER=live")) return true;
    } else {
      const out = await probe("ps", [
        "eww",
        "-p",
        String(pid),
        "-o",
        "command=",
      ]);
      if (/\bAGENTOS_SERVER=live\b/.test(out)) return true;
    }
    return (
      (await probe("ps", ["-p", String(pid), "-o", "comm="])).trim() ===
      "agentos-server"
    );
  } catch (e) {
    return e instanceof ProbeTimeout;
  }
}

export const samePath = (a: string, b: string): boolean => real(a) === real(b);
