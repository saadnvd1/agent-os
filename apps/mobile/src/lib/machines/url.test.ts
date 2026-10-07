import { describe, expect, it } from "vitest";
import {
  machineLabel,
  normalizeMachineUrl,
  pairLinkCode,
  socketUrl,
} from "./url";

describe("normalizeMachineUrl", () => {
  it("adds http for an IP and keeps the port", () => {
    expect(normalizeMachineUrl(" 100.64.0.1:3011/ ")).toEqual({
      ok: true,
      url: "http://100.64.0.1:3011",
    });
  });

  it("adds https for a hostname and drops any path", () => {
    expect(
      normalizeMachineUrl("Saads-MacBook-Pro.example.ts.net:3443/pair#x")
    ).toEqual({
      ok: true,
      url: "https://laptop.example.ts.net:3443",
    });
  });

  it("keeps an explicit scheme", () => {
    expect(normalizeMachineUrl("http://127.0.0.1:3011")).toEqual({
      ok: true,
      url: "http://127.0.0.1:3011",
    });
  });

  it("refuses empty and non-web addresses", () => {
    expect(normalizeMachineUrl("").ok).toBe(false);
    expect(normalizeMachineUrl("ftp://host").ok).toBe(false);
  });
});

describe("socketUrl and machineLabel", () => {
  it("swaps the scheme for ws", () => {
    expect(socketUrl("https://a.ts.net:3443", "/ws/status")).toBe(
      "wss://a.ts.net:3443/ws/status"
    );
    expect(socketUrl("http://127.0.0.1:3011", "/ws/chat?session=1")).toBe(
      "ws://127.0.0.1:3011/ws/chat?session=1"
    );
  });

  it("names a machine by its first host label", () => {
    expect(
      machineLabel("https://laptop.example.ts.net:3443")
    ).toBe("laptop");
    expect(machineLabel("http://100.64.0.1:3011")).toBe("100.64.0.1");
  });
});

describe("pairLinkCode", () => {
  it("takes the code from a pairing link", () => {
    expect(
      pairLinkCode("https://mac.tail.ts.net:3443/pair#abcd-efgh-jkmn-pqrs")
    ).toBe("ABCD-EFGH-JKMN-PQRS");
  });
  it("is null for a plain address", () => {
    expect(pairLinkCode("100.64.0.1:3011")).toBeNull();
  });
});
