import { describe, it, expect } from "vitest";
import {
  claimPairing,
  formatCode,
  normalizeCode,
  pairingStatus,
  startPairing,
} from "./pairing";
import { deviceForToken } from "./devices";

const claim = (code: string, address = "10.0.0.9", now?: number) =>
  claimPairing({ code, name: "Phone", address }, now);

describe("pairing", () => {
  it("makes 16-character codes that survive being typed sloppily", () => {
    const { code } = startPairing();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
    expect(normalizeCode(formatCode(code).toLowerCase())).toBe(code);
    expect(normalizeCode("o0-il")).toBe("0011");
  });

  it("claims once and hands back a working token", () => {
    const { code } = startPairing();
    const first = claim(formatCode(code));
    expect(first.ok).toBe(true);
    if (first.ok)
      expect(deviceForToken(first.token)).toEqual({ id: first.device.id });
    expect(pairingStatus(code)).toEqual({ state: "claimed", name: "Phone" });
    expect(claim(code, "10.0.0.10")).toEqual({ ok: false, error: "invalid" });
  });

  it("expires after ten minutes", () => {
    const now = Date.now();
    const { code } = startPairing(now);
    expect(claim(code, "10.0.0.11", now + 10 * 60_000 + 1)).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it("rate-limits guesses per address", () => {
    for (let i = 0; i < 10; i++)
      expect(claim("WRONGWRONGWRONG0", "10.0.0.12")).toEqual({
        ok: false,
        error: "invalid",
      });
    const { code } = startPairing();
    expect(claim(code, "10.0.0.12")).toEqual({
      ok: false,
      error: "rate_limited",
    });
    expect(claim(code, "10.0.0.13").ok).toBe(true);
  });
});
