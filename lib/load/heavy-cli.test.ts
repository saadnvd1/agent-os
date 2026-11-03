import fs from "fs";
import http from "http";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { releaseLease, requestLease, resetLeases } from "./heavy-lease";
import { tempDir } from "@/lib/test-temp";

const AOS = path.join(process.cwd(), "bin/aos");

// The real lease module behind the route's wire format.
function leaseServer() {
  const asked: string[] = [];
  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      asked.push(req.url ?? "");
      if (req.url !== "/api/load/heavy/lease") return res.end("{}");
      const { session, pid, action } = JSON.parse(data);
      if (action === "release") {
        releaseLease(session, pid);
        return res.end(JSON.stringify({ released: true }));
      }
      res.end(
        JSON.stringify(
          requestLease(session, pid, Date.now(), action === "renew")
        )
      );
    });
  });
  return new Promise<{ url: string; asked: string[]; close: () => void }>(
    (resolve) =>
      server.listen(0, "127.0.0.1", () =>
        resolve({
          url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          asked,
          close: () => {
            server.closeAllConnections();
            server.close();
          },
        })
      )
  );
}

const env = (url: string, extra: Record<string, string> = {}) => {
  const { AOS_HEAVY_HELD: _held, ...rest } = process.env;
  return { ...rest, AGENTOS_URL: url, ...extra };
};

function run(url: string, script: string, extra: Record<string, string> = {}) {
  const child = spawn(
    process.execPath,
    [AOS, "heavy", "--", "sh", "-c", script],
    {
      env: env(url, extra),
    }
  );
  let stderr = "";
  child.stderr.on("data", (c) => (stderr += c));
  const done = new Promise<number | null>((r) => child.on("exit", (c) => r(c)));
  return { child, done, stderr: () => stderr };
}

const until = async (ok: () => boolean, ms = 15_000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
};

const live: ChildProcess[] = [];
beforeEach(() => {
  resetLeases();
  vi.stubEnv("AGENTOS_HEAVY_SLOTS_CALM", "1");
  vi.stubEnv("AGENTOS_HEAVY_SLOTS", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const c of live.splice(0)) c.kill("SIGKILL");
  resetLeases();
});

describe("aos heavy takes a slot", () => {
  it("makes the second run wait until the first exits", async () => {
    const server = await leaseServer();
    const dir = tempDir("aos-lease-");
    const go = path.join(dir, "go");
    const first = path.join(dir, "first");
    const second = path.join(dir, "second");
    try {
      const a = run(
        server.url,
        `: > '${first}'; while [ ! -f '${go}' ]; do sleep 0.1; done`
      );
      live.push(a.child);
      await until(() => fs.existsSync(first));
      const b = run(server.url, `: > '${second}'`);
      live.push(b.child);
      await until(() =>
        /waiting for a heavy slot \(1 ahead\)/.test(b.stderr())
      );
      expect(fs.existsSync(second)).toBe(false);
      fs.writeFileSync(go, "");
      expect(await a.done).toBe(0);
      expect(await b.done).toBe(0);
      expect(fs.statSync(second).mtimeMs).toBeGreaterThanOrEqual(
        fs.statSync(go).mtimeMs
      );
      expect(b.stderr()).toMatch(/got a heavy slot after/);
    } finally {
      server.close();
    }
  }, 30_000);

  it("takes a crashed holder's slot back through the reaper", async () => {
    const server = await leaseServer();
    const dir = tempDir("aos-lease-");
    const first = path.join(dir, "first");
    const second = path.join(dir, "second");
    try {
      const a = run(server.url, `: > '${first}'; sleep 60`);
      live.push(a.child);
      await until(() => fs.existsSync(first));
      const b = run(server.url, `: > '${second}'`);
      live.push(b.child);
      await until(() => /waiting for a heavy slot/.test(b.stderr()));
      a.child.kill("SIGKILL");
      expect(await b.done).toBe(0);
      expect(fs.existsSync(second)).toBe(true);
    } finally {
      server.close();
    }
  }, 30_000);

  it("runs the command when the server is down or never answers", async () => {
    const down = Date.now();
    const a = run("http://127.0.0.1:1", "exit 3");
    expect(await a.done).toBe(3);
    expect(a.stderr()).toBe("");

    const hung = http.createServer(() => {});
    await new Promise<void>((r) => hung.listen(0, "127.0.0.1", r));
    try {
      const b = run(
        `http://127.0.0.1:${(hung.address() as AddressInfo).port}`,
        "exit 0"
      );
      expect(await b.done).toBe(0);
      expect(Date.now() - down).toBeLessThan(6000);
    } finally {
      hung.closeAllConnections();
      hung.close();
    }
  });

  it("asks only the server it is pointed at", async () => {
    const mine = await leaseServer();
    const other = await leaseServer();
    try {
      expect(await run(mine.url, "exit 0").done).toBe(0);
      expect(mine.asked).toContain("/api/load/heavy/lease");
      expect(other.asked).toEqual([]);
    } finally {
      mine.close();
      other.close();
    }
  });

  it("doesn't wait on its own slot when nested", async () => {
    const server = await leaseServer();
    try {
      const outer = run(
        server.url,
        `"${process.execPath}" "${AOS}" heavy -- true`
      );
      live.push(outer.child);
      expect(await outer.done).toBe(0);
    } finally {
      server.close();
    }
  }, 30_000);
});
