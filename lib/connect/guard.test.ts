import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { shouldStartConnect, takeConnectLock } from "./guard";

const prod = { NODE_ENV: "production" } as NodeJS.ProcessEnv;

describe("shouldStartConnect", () => {
  it("starts only the production server on AgentOS's port", () => {
    expect(shouldStartConnect(prod, 3011)).toEqual({ start: true });
    expect(
      shouldStartConnect({ ...prod, AGENT_OS_PORT: "4000" }, 4000)
    ).toEqual({ start: true });
  });
  it.each([
    [{ NODE_ENV: "development" }, 3011, "not a production build"],
    [{ NODE_ENV: "test" }, 3011, "not a production build"],
    [prod, 3150, "port 3150"],
    [{ ...prod, AGENTOS_AUTH: "off" }, 3011, "AGENTOS_AUTH=off"],
    [{ ...prod, AGENTOS_CONNECT: "0" }, 3011, "AGENTOS_CONNECT=0"],
  ])("refuses %j on %i", (env, port, reason) => {
    const d = shouldStartConnect(env as NodeJS.ProcessEnv, port);
    expect(d.start).toBe(false);
    if (!d.start) expect(d.reason).toContain(reason);
  });
  it("lets AGENTOS_CONNECT=1 pick another port, but never with auth off", () => {
    expect(shouldStartConnect({ ...prod, AGENTOS_CONNECT: "1" }, 3150)).toEqual(
      { start: true }
    );
    expect(
      shouldStartConnect(
        { ...prod, AGENTOS_CONNECT: "1", AGENTOS_AUTH: "off" },
        3150
      ).start
    ).toBe(false);
  });
});

describe("takeConnectLock", () => {
  it("lets one live process hold the tunnel, and takes over a stale lock", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connect-lock-"));
    const first = takeConnectLock(dir, 111, () => true);
    expect("release" in first).toBe(true);
    expect(takeConnectLock(dir, 222, () => true)).toEqual({ heldBy: 111 });
    // 111 died without releasing: the lock is stale.
    expect("release" in takeConnectLock(dir, 222, () => false)).toBe(true);
  });
  it("releases only its own lock", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connect-lock-"));
    const a = takeConnectLock(dir, 111, () => true) as { release: () => void };
    a.release();
    expect(fs.existsSync(path.join(dir, "connect.lock"))).toBe(false);
  });
});

describe("takeConnectLock races", () => {
  const lockIn = (dir: string) => path.join(dir, "connect.lock");

  it("gives the lock back when a live process took it between the look and the rename", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connect-lock-"));
    fs.writeFileSync(lockIn(dir), "999"); // stale
    const alive = (pid: number) => {
      // While we decide 999 is dead, process 222 takes the lock over.
      if (pid === 999) fs.writeFileSync(lockIn(dir), "222");
      return pid === 222;
    };
    expect(takeConnectLock(dir, 111, alive)).toEqual({ heldBy: 222 });
    expect(fs.readFileSync(lockIn(dir), "utf8")).toBe("222");
  });

  it("never throws, even on a lock it can't read", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connect-lock-"));
    fs.mkdirSync(lockIn(dir)); // not a file at all
    let result: ReturnType<typeof takeConnectLock> | undefined;
    expect(
      () => (result = takeConnectLock(dir, 111, () => false))
    ).not.toThrow();
    expect(result && "release" in result).toBe(true);
    expect(() =>
      takeConnectLock(path.join(dir, "missing", "deeper"), 111)
    ).not.toThrow();
  });
});
