import { describe, it, expect } from "vitest";
import { reachFrom } from "./reach";
import { parseStatus, type TailscaleState } from "@/lib/tailscale";

describe("parseStatus", () => {
  it("reads a running node", () => {
    const raw = JSON.stringify({
      BackendState: "Running",
      Self: {
        DNSName: "mac.tail1.ts.net.",
        TailscaleIPs: ["100.64.0.1", "fd7a::1"],
      },
      CertDomains: ["mac.tail1.ts.net"],
    });
    expect(parseStatus(raw)).toEqual({
      state: "running",
      ips: ["100.64.0.1"],
      dnsName: "mac.tail1.ts.net",
      https: true,
    });
  });

  it("treats anything but Running as signed out", () => {
    expect(parseStatus(JSON.stringify({ BackendState: "NeedsLogin" }))).toEqual(
      { state: "logged-out" }
    );
  });
});

describe("reachFrom", () => {
  const ts: TailscaleState = {
    state: "running",
    ips: ["100.1.2.3"],
    dnsName: "mac.ts.net",
    https: false,
  };

  it("puts Tailscale's name first, then its IP, then Wi-Fi", () => {
    expect(reachFrom(ts, ["10.0.0.5"], 3011).map((r) => r.url)).toEqual([
      "http://mac.ts.net:3011",
      "http://100.1.2.3:3011",
      "http://10.0.0.5:3011",
    ]);
  });

  it("puts the Connect address first when Connect is on", () => {
    expect(reachFrom(ts, [], 3011, "abcd1234.on.runagentos.com")[0]).toEqual({
      kind: "connect",
      url: "https://abcd1234.on.runagentos.com",
    });
  });

  it("offers the tailnet's HTTPS address before its plain ones", () => {
    const urls = reachFrom(ts, [], 3011, null, "https://mac.ts.net:3443").map(
      (r) => r.url
    );
    expect(urls).toEqual([
      "https://mac.ts.net:3443",
      "http://mac.ts.net:3011",
      "http://100.1.2.3:3011",
    ]);
  });

  it("is empty when nothing else can reach this machine", () => {
    expect(reachFrom({ state: "missing" }, [], 3011)).toEqual([]);
  });
});
