import { describe, expect, it } from "vitest";
import { endpointsFrom, failoverOrder, firstAnswering } from "./endpoints";

describe("endpointsFrom", () => {
  it("never learns a plain-http or unknown-host address: the token would go there in clear", () => {
    expect(
      endpointsFrom(
        {
          reach: [
            { kind: "lan", url: "http://192.168.1.5:3011" },
            { kind: "tailscale", url: "http://100.64.0.1:3011" },
            { kind: "tailscale", url: "https://evil.example.com" },
            { kind: "tailscale", url: "https://mac.tail.ts.net:3443" },
          ],
        },
        "http://127.0.0.1:3011"
      )
    ).toEqual(["https://mac.tail.ts.net:3443", "http://127.0.0.1:3011"]);
  });

  it("lists Connect first when it's on, then the reach list, without repeats", () => {
    expect(
      endpointsFrom(
        {
          connect: {
            state: "connected",
            hostname: "abcd1234.on.runagentos.com",
          },
          reach: [
            { kind: "tailscale", url: "https://mac.tail.ts.net:3443" },
            { kind: "tailscale", url: "http://100.64.0.1:3011" },
          ],
        },
        "http://100.64.0.1:3011"
      )
    ).toEqual([
      "https://abcd1234.on.runagentos.com",
      "https://mac.tail.ts.net:3443",
      "http://100.64.0.1:3011",
    ]);
  });

  it("leaves Connect out while it's off, and keeps the current address", () => {
    expect(
      endpointsFrom(
        {
          connect: { state: "off", hostname: "x.on.runagentos.com" },
          reach: [],
        },
        "http://127.0.0.1:3011"
      )
    ).toEqual(["http://127.0.0.1:3011"]);
  });
});

describe("failover", () => {
  it("never moves from https to http", () => {
    expect(
      failoverOrder(
        ["https://x.on.runagentos.com", "http://127.0.0.1:3011"],
        "https://mac.tail.ts.net:3443"
      )
    ).toEqual(["https://mac.tail.ts.net:3443", "https://x.on.runagentos.com"]);
  });

  it("tries the current address first", () => {
    expect(failoverOrder(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  });

  it("takes the first address, in order, that answers", async () => {
    const up = new Set(["c", "b"]);
    expect(await firstAnswering(["a", "b", "c"], async (u) => up.has(u))).toBe(
      "b"
    );
    expect(await firstAnswering(["a"], async () => false)).toBeNull();
    expect(
      await firstAnswering(["a", "b"], async (u) =>
        u === "a" ? Promise.reject(new Error()) : true
      )
    ).toBe("b");
  });
});
