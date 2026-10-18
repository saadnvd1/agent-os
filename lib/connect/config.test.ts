import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  connectTunnelPort,
  readConnect,
  saveConnect,
  serverPort,
  setConnectEnabled,
  loadConnect,
} from "./config";
import { tempDir } from "@/lib/test-temp";

const dirWith = (files: Record<string, string>) => {
  const dir = tempDir("connect-cfg-");
  for (const [f, v] of Object.entries(files))
    fs.writeFileSync(path.join(dir, f), v);
  return dir;
};
const HOST = "m-0123456789abcdef.runagentos.com";
const good = {
  "connect.json": JSON.stringify({
    machineId: "abcd1234",
    hostname: HOST,
    apiUrl: "https://runagentos.com",
  }),
  "machine.key": "k",
};

describe("readConnect", () => {
  it("says what's wrong instead of failing silently", () => {
    expect(readConnect(dirWith({}))).toEqual({
      ok: false,
      reason: "not enrolled",
    });
    expect(readConnect(dirWith({ "connect.json": "{nope" }))).toMatchObject({
      ok: false,
      reason: expect.stringContaining("not valid JSON"),
    });
    expect(readConnect(dirWith({ "connect.json": "{}" }))).toMatchObject({
      ok: false,
      reason: expect.stringContaining("missing machineId"),
    });
    expect(
      readConnect(
        dirWith({ ...good, "connect.json": '{"machineId":"abcd1234"}' })
      )
    ).toMatchObject({
      ok: false,
      reason: expect.stringContaining("no Connect service"),
    });
    const { "machine.key": _, ...noKey } = good;
    expect(readConnect(dirWith(noKey))).toMatchObject({
      ok: false,
      reason: expect.stringContaining("machine.key is missing"),
    });
  });

  it("drops a name that isn't m-<16 hex>.runagentos.com (the relay's, or worse)", () => {
    for (const hostname of [
      "abcd1234.on.runagentos.com",
      "m-0123456789abcdef.runagentos.com.evil.com",
      "M-0123456789ABCDEF.runagentos.com",
      "m-0123456789abcde.runagentos.com",
      "app.runagentos.com",
    ]) {
      const dir = dirWith({
        ...good,
        "connect.json": JSON.stringify({
          machineId: "abcd1234",
          hostname,
          apiUrl: "https://runagentos.com",
          relayUrl: "wss://relay.example",
        }),
      });
      const r = readConnect(dir);
      expect(r.ok && r.files.config).toEqual({
        machineId: "abcd1234",
        hostname: "",
        apiUrl: "https://runagentos.com",
      });
    }
    const r = readConnect(dirWith(good));
    expect(r.ok && r.files.config.hostname).toBe(HOST);
  });

  it("turns on and off without touching the keys", () => {
    const dir = dirWith(good);
    expect(readConnect(dir)).toMatchObject({ ok: true, enabled: true });
    expect(setConnectEnabled(false, dir)).toBe(true);
    expect(readConnect(dir)).toMatchObject({ ok: true, enabled: false });
    expect(loadConnect(dir)).toBeNull();
    expect(fs.readFileSync(path.join(dir, "machine.key"), "utf8")).toBe("k");
    expect(setConnectEnabled(true, dirWith({}))).toBe(false);
  });

  it("saves owner-only, keeps the switch off, and drops old relay fields", () => {
    const dir = dirWith({
      ...good,
      "connect.json": JSON.stringify({
        machineId: "abcd1234",
        hostname: "abcd1234.on.runagentos.com",
        relayUrl: "wss://relay.example",
        apiUrl: "https://runagentos.com",
        enabled: false,
      }),
    });
    saveConnect(
      {
        machineId: "abcd1234",
        hostname: HOST,
        apiUrl: "https://runagentos.com",
      },
      dir
    );
    const p = path.join(dir, "connect.json");
    expect(JSON.parse(fs.readFileSync(p, "utf8"))).toEqual({
      machineId: "abcd1234",
      hostname: HOST,
      apiUrl: "https://runagentos.com",
      enabled: false,
    });
    expect(fs.statSync(p).mode & 0o777).toBe(0o600);
  });
});

describe("connectTunnelPort", () => {
  it("defaults to AgentOS's port + 433, and refuses an unusable port", () => {
    expect(connectTunnelPort(3011, {})).toBe(3444);
    expect(connectTunnelPort(3011, { AGENTOS_CONNECT_PORT: "4000" })).toBe(
      4000
    );
    for (const bad of ["70000", "0", "abc", "3011", "1.5"])
      expect(connectTunnelPort(3011, { AGENTOS_CONNECT_PORT: bad })).toBeNull();
  });
});

describe("serverPort", () => {
  it("reads the port the way server.ts does: -p, then PORT, then 3011", () => {
    expect(
      serverPort(["node", "server.ts", "-p", "3012"], { PORT: "4000" })
    ).toBe(3012);
    expect(serverPort(["node", "server.ts"], { PORT: "4000" })).toBe(4000);
    expect(serverPort(["node", "server.ts"], {})).toBe(3011);
  });
});
