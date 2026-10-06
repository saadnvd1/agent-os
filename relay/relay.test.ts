import { describe, it, expect, beforeAll, afterAll } from "vitest";
import https from "https";
import type { AddressInfo } from "net";
import { createRelay } from "./relay";
import { makeTestPki, type TestPki } from "./test-certs";
import { generateMachineKey } from "@/lib/connect/identity";
import { startTunnel } from "@/lib/connect/tunnel";
import { decode, Frame } from "@/lib/connect/frames";

const SECRET = "only-the-machine-can-read-this";
let pki: TestPki;
let relay: ReturnType<typeof createRelay>;
let port: number;
const keys = new Map<string, string>();
const seenByRelay: Buffer[] = [];
let stopTunnel: () => void;

function phoneGet(
  host: string,
  path: string
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        host: "127.0.0.1",
        port,
        path,
        servername: host,
        headers: { Host: host },
        ca: pki.ca,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode!, body }));
      }
    );
    req.on("error", reject);
  });
}

beforeAll(async () => {
  pki = makeTestPki();
  relay = createRelay({
    relayHost: "relay.test",
    machineDomain: "on.test",
    tls: pki.leaf("relay.test"),
    keys: { publicKey: async (id) => keys.get(id) ?? null },
  });
  await new Promise<void>((r) => relay.server.listen(0, "127.0.0.1", r));
  port = (relay.server.address() as AddressInfo).port;

  const machine = generateMachineKey();
  keys.set("m1", machine.publicKey);
  const app = https.createServer(pki.leaf("m1.on.test"), (req, res) => {
    if (req.url === "/big") return res.end(Buffer.alloc(5 << 20, 7));
    res.end(`${SECRET} ${req.url}`);
  });
  const tunnel = startTunnel({
    config: {
      machineId: "m1",
      hostname: "m1.on.test",
      relayUrl: `wss://127.0.0.1:${port}`,
      relayServername: "relay.test",
      relayCa: pki.ca,
    },
    machineKey: machine.privateKey,
    onStream: (s) => {
      // What the relay forwards to us, before our TLS opens it.
      s.on("data", () => {});
      const orig = s.receive.bind(s);
      s.receive = (chunk: Buffer) => {
        seenByRelay.push(chunk);
        orig(chunk);
      };
      app.emit("connection", s);
    },
  });
  stopTunnel = tunnel.stop;
  for (let i = 0; i < 100 && tunnel.state() !== "up"; i++)
    await new Promise((r) => setTimeout(r, 20));
  expect(tunnel.state()).toBe("up");
}, 30_000);

afterAll(() => {
  stopTunnel?.();
  relay?.server.close();
});

describe("relay", () => {
  it("carries a phone's HTTPS request to the machine, end to end", async () => {
    const res = await phoneGet("m1.on.test", "/hello");
    expect(res).toEqual({ status: 200, body: `${SECRET} /hello` });
  });

  it("never sees the plaintext it carries", async () => {
    await phoneGet("m1.on.test", "/private-path");
    const all = Buffer.concat(seenByRelay).toString("latin1");
    expect(all.length).toBeGreaterThan(0);
    expect(all).not.toContain("/private-path");
    expect(all).not.toContain("GET ");
  });

  it("handles parallel streams and a 5 MB response", async () => {
    const results = await Promise.all([
      phoneGet("m1.on.test", "/big"),
      ...Array.from({ length: 10 }, (_, i) => phoneGet("m1.on.test", `/p${i}`)),
    ]);
    expect(results[0].body.length).toBe(5 << 20);
    results.slice(1).forEach((r, i) => expect(r.body).toBe(`${SECRET} /p${i}`));
  });

  it("drops a connection for a machine that isn't connected", async () => {
    await expect(phoneGet("nobody.on.test", "/")).rejects.toThrow();
  });

  it("answers its own health check", async () => {
    const res = await phoneGet("relay.test", "/health");
    expect(JSON.parse(res.body)).toEqual({ ok: true, machines: 1 });
  });

  it("refuses a machine whose key it doesn't know", async () => {
    const stranger = generateMachineKey();
    const frames: number[] = [];
    const t = startTunnel({
      config: {
        machineId: "m2",
        hostname: "m2.on.test",
        relayUrl: `wss://127.0.0.1:${port}`,
        relayServername: "relay.test",
        relayCa: pki.ca,
      },
      machineKey: stranger.privateKey,
      onStream: () => {},
    });
    for (let i = 0; i < 100 && t.state() !== "denied"; i++)
      await new Promise((r) => setTimeout(r, 20));
    expect(t.state()).toBe("denied");
    t.stop();
    expect(relay.tunnels.has("m2")).toBe(false);
    expect(frames).toEqual([]);
  });
});

describe("frames", () => {
  it("rejects junk", () => {
    expect(decode(Buffer.from([1, 2]))).toBeNull();
    expect(decode(Buffer.from([99, 0, 0, 0, 1]))).toBeNull();
    expect(decode(Buffer.from([Frame.DATA, 0, 0, 0, 7, 65]))).toMatchObject({
      type: Frame.DATA,
      stream: 7,
    });
  });
});
