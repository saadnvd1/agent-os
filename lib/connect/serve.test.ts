import { describe, it, expect, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import https from "https";
import { generateMachineKey } from "./identity";
import { makeTestPki } from "./test-pki";
import { testRelay } from "./test-relay";
import { connectStatus, startConnect } from "./serve";
import { setConnectEnabled } from "./config";

const HOST = "abcd1234.on.test";
const wait = async (f: () => boolean, ms = 8000) => {
  for (let t = 0; t < ms && !f(); t += 50)
    await new Promise((r) => setTimeout(r, 50));
};

describe("Connect runtime", () => {
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("follows the switch, pins the Host, and only runs where it should", async () => {
    const pki = makeTestPki();
    const machine = generateMachineKey();
    const relay = await testRelay(machine.publicKey);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connect-serve-"));
    const leaf = pki.leaf(HOST);
    fs.writeFileSync(
      path.join(dir, "connect.json"),
      JSON.stringify({
        machineId: "abcd1234",
        hostname: HOST,
        relayUrl: relay.url,
      })
    );
    fs.writeFileSync(path.join(dir, "machine.key"), machine.privateKey);
    fs.writeFileSync(path.join(dir, "tls.key"), leaf.key);
    fs.writeFileSync(path.join(dir, "tls.crt"), leaf.cert);
    vi.stubEnv("AGENTOS_CONNECT_DIR", dir);

    // A dev server never tunnels.
    vi.stubEnv("NODE_ENV", "development");
    startConnect({ onRequest: () => {}, onUpgrade: () => {} }, 3011, () => {});
    expect(connectStatus()).toMatchObject({
      state: "refused",
      reason: "not a production build",
    });

    vi.stubEnv("NODE_ENV", "production");
    const logs: string[] = [];
    startConnect(
      {
        onRequest: (_q, s) => s.end("agentos"),
        onUpgrade: (_q, s) => s.destroy(),
      },
      3011,
      (l) => logs.push(l)
    );
    await wait(() => relay.connected());
    expect(connectStatus().state).toBe("up");

    const get = (host: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        https
          .get(
            {
              host: "127.0.0.1",
              port: relay.frontPort,
              servername: HOST,
              headers: { Host: host },
              ca: pki.ca,
              agent: false,
            },
            (res) => {
              let body = "";
              res.on("data", (c) => (body += c));
              res.on("end", () => resolve({ status: res.statusCode!, body }));
            }
          )
          .on("error", reject);
      });
    expect(await get(HOST)).toEqual({ status: 200, body: "agentos" });
    expect((await get("evil.example")).status).toBe(421);

    // A second process sharing this folder can't take the tunnel.
    const lock = fs.readFileSync(path.join(dir, "connect.lock"), "utf8");
    expect(lock).toBe(String(process.pid));

    // The switch closes the tunnel within seconds, without a restart.
    setConnectEnabled(false, dir);
    await wait(() => !relay.connected());
    expect(relay.connected()).toBe(false);
    expect(connectStatus().state).toBe("off");
    expect(fs.existsSync(path.join(dir, "connect.lock"))).toBe(false);

    setConnectEnabled(true, dir);
    await wait(() => relay.connected());
    expect(relay.connected()).toBe(true);
    setConnectEnabled(false, dir);
    await wait(() => !relay.connected());
    relay.close();
  }, 30_000);
});
