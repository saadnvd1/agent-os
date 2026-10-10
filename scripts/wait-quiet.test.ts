import { execFile } from "child_process";
import http from "http";
import type { AddressInfo } from "net";
import path from "path";
import { promisify } from "util";
import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const script = path.join(__dirname, "wait-quiet");

// A stand-in server whose /api/busy says busy for its first `busyFor` asks.
let server: http.Server | null = null;
async function busyServer(busyFor: number) {
  let asked = 0;
  server = http.createServer((req, res) => {
    asked++;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ reviews: 1, setups: 0, busy: asked <= busyFor }));
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return { port: (server.address() as AddressInfo).port, asked: () => asked };
}

const wait = (port: number, cap: number) => {
  const started = Date.now();
  return run(script, {
    env: {
      ...process.env,
      PORT: String(port),
      AGENTOS_QUIET_WAIT: String(cap),
      AGENTOS_QUIET_POLL: "0.2",
    },
  }).then(({ stdout }) => ({ stdout, ms: Date.now() - started }));
};

afterEach(() => {
  server?.close();
  server = null;
});

describe("scripts/wait-quiet", () => {
  it("waits while the server has work in flight, then returns", async () => {
    const s = await busyServer(3);
    const { stdout } = await wait(s.port, 30);
    expect(s.asked()).toBe(4);
    expect(stdout).toContain("Waiting for in-flight work");
    expect(stdout).not.toContain("anyway");
  });

  it("gives up at the cap, so the deploy still lands", async () => {
    const s = await busyServer(Infinity);
    const { stdout, ms } = await wait(s.port, 1);
    expect(stdout).toContain("Still busy after 1s; restarting anyway");
    expect(ms).toBeLessThan(5000);
  });

  it("doesn't wait on a server that doesn't answer", async () => {
    const s = await busyServer(0);
    const port = s.port;
    await new Promise((r) => server!.close(r));
    server = null;
    const { stdout, ms } = await wait(port, 30);
    expect(stdout).toBe("");
    expect(ms).toBeLessThan(5000);
  });
});
