import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { readConnect, setConnectEnabled, loadConnect } from "./config";
import { certStatus } from "./cert-check";

const dirWith = (files: Record<string, string>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connect-cfg-"));
  for (const [f, v] of Object.entries(files))
    fs.writeFileSync(path.join(dir, f), v);
  return dir;
};
const good = {
  "connect.json": JSON.stringify({
    machineId: "abcd1234",
    hostname: "abcd1234.on.test",
    relayUrl: "wss://r",
  }),
  "machine.key": "k",
  "tls.key": "k",
  "tls.crt": "c",
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
    const { "tls.crt": _, ...noCert } = good;
    expect(readConnect(dirWith(noCert))).toMatchObject({
      ok: false,
      reason: expect.stringContaining("tls.crt is missing"),
    });
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
});

describe("certStatus", () => {
  it("warns when unreadable", () => {
    expect(certStatus("garbage").warning).toContain("can't be read");
  });
});
