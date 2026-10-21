import http from "http";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cachedAvailability,
  checkAvailability,
  clearAvailability,
  probeUrl,
} from "./availability";

let server: http.Server;
let base: string;
let hits = 0;

beforeEach(async () => {
  clearAvailability();
  hits = 0;
  server = http.createServer((_req, res) => {
    hits++;
    res.statusCode = 401;
    res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  vi.useRealTimers();
  await new Promise((r) => server.close(r));
});

describe("availability", () => {
  it("builds the URL each API lists its models at", () => {
    expect(probeUrl("http://h:1/v1", "openai")).toBe("http://h:1/v1/models");
    expect(probeUrl("http://h:1/", "anthropic")).toBe("http://h:1/v1/models");
    expect(probeUrl("http://h:1/v1", "anthropic")).toBe("http://h:1/v1/models");
  });

  it("counts any HTTP answer as up", async () => {
    const r = await checkAvailability(`${base}/models`);
    expect(r.state).toBe("up");
    expect(r.checkedAt).toBeTruthy();
  });

  it("is down when the connection is refused", async () => {
    const port = (server.address() as AddressInfo).port;
    await new Promise((r) => server.close(r));
    const r = await checkAvailability(`http://127.0.0.1:${port}/models`);
    expect(r.state).toBe("down");
    expect(r.error).toMatch(/ECONNREFUSED/);
    server = http.createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  });

  it("is down when nothing answers in time", async () => {
    const slow = http.createServer(() => {});
    await new Promise<void>((r) => slow.listen(0, "127.0.0.1", r));
    const port = (slow.address() as AddressInfo).port;
    const r = await checkAvailability(`http://127.0.0.1:${port}/models`);
    slow.closeAllConnections();
    await new Promise((r) => slow.close(r));
    expect(r).toMatchObject({
      state: "down",
      error: expect.stringMatching(/no answer/),
    });
  });

  it("caches an answer, and probes again when asked to refresh", async () => {
    await checkAvailability(`${base}/models`);
    await checkAvailability(`${base}/models`);
    expect(hits).toBe(1);
    await checkAvailability(`${base}/models`, true);
    expect(hits).toBe(2);
  });

  it("answers unknown at first without waiting, then from the cache", async () => {
    expect(cachedAvailability(`${base}/models`).state).toBe("unknown");
    await vi.waitFor(() => expect(hits).toBe(1));
    await vi.waitFor(() =>
      expect(cachedAvailability(`${base}/models`).state).toBe("up")
    );
  });
});
