import { describe, it, expect } from "vitest";
import {
  generateMachineKey,
  NonceCache,
  signHello,
  verifyHello,
} from "./identity";

const key = generateMachineKey();

describe("machine identity", () => {
  it("accepts a fresh signed hello once", () => {
    const nonces = new NonceCache();
    const h = signHello("m1", key.privateKey);
    expect(verifyHello(h, key.publicKey, nonces)).toEqual({
      ok: true,
      machineId: "m1",
    });
    expect(verifyHello(h, key.publicKey, nonces)).toEqual({
      ok: false,
      error: "replayed",
    });
  });

  it("refuses another key, a changed id, an old hello, an unknown machine", () => {
    const other = generateMachineKey();
    const h = signHello("m1", key.privateKey);
    expect(verifyHello(h, other.publicKey, new NonceCache()).ok).toBe(false);
    expect(
      verifyHello({ ...h, machineId: "m2" }, key.publicKey, new NonceCache())
    ).toEqual({ ok: false, error: "bad signature" });
    const old = signHello("m1", key.privateKey, Date.now() - 5 * 60_000);
    expect(verifyHello(old, key.publicKey, new NonceCache())).toEqual({
      ok: false,
      error: "clock skew",
    });
    expect(verifyHello(h, null, new NonceCache())).toEqual({
      ok: false,
      error: "unknown machine",
    });
  });
});
