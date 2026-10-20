import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseNetstatListeners,
  resetWindowsPortsCache,
  windowsListeningPorts,
} from "./windows-ports";

const NETSTAT = [
  "",
  "Active Connections",
  "",
  "  Proto  Local Address          Foreign Address        State           PID",
  "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1100",
  "  TCP    127.0.0.1:3000         0.0.0.0:0              ABHÖREN         4242",
  "  TCP    [::]:5173              [::]:0                 LISTENING       7",
  "  TCP    192.168.1.5:50123      52.1.2.3:443           ESTABLISHED     900",
  "  TCP    [::1]:8080             [::]:0                 LISTENING       8",
].join("\r\n");

beforeEach(resetWindowsPortsCache);

describe("parseNetstatListeners", () => {
  it("takes wildcard-peer rows in any locale, v4 and v6, and skips connections", () => {
    expect([...parseNetstatListeners(NETSTAT)].sort((a, b) => a - b)).toEqual([
      135, 3000, 5173, 8080,
    ]);
  });

  it("is empty for garbage", () => {
    expect(parseNetstatListeners("not netstat").size).toBe(0);
  });
});

describe("windowsListeningPorts", () => {
  it("asks only under WSL 2", async () => {
    const run = vi.fn(async () => NETSTAT);
    expect(await windowsListeningPorts({ wsl: 0, run })).toBeNull();
    expect(await windowsListeningPorts({ wsl: 1, run })).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect((await windowsListeningPorts({ wsl: 2, run }))?.has(3000)).toBe(
      true
    );
    expect(run).toHaveBeenCalledWith("netstat.exe", ["-ano", "-p", "TCP"]);
  });

  it("caches briefly, then asks again", async () => {
    const run = vi.fn(async () => NETSTAT);
    await windowsListeningPorts({ wsl: 2, run, now: 1000 });
    await windowsListeningPorts({ wsl: 2, run, now: 2000 });
    expect(run).toHaveBeenCalledTimes(1);
    await windowsListeningPorts({ wsl: 2, run, now: 5000 });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("shares one call between concurrent askers", async () => {
    const run = vi.fn(async () => NETSTAT);
    await Promise.all([
      windowsListeningPorts({ wsl: 2, run }),
      windowsListeningPorts({ wsl: 2, run }),
    ]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("treats a failure as unknown rather than throwing", async () => {
    const run = async () => {
      throw new Error("netstat.exe not found");
    };
    expect(await windowsListeningPorts({ wsl: 2, run })).toBeNull();
  });
});
