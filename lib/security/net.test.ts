import { describe, it, expect } from "vitest";
import type os from "os";
import {
  bindAddresses,
  hostAllowed,
  originAllowed,
  requestAllowed,
  tailscaleAddresses,
  upgradeAllowed,
  type AccessPolicy,
} from "./net";

const iface = (address: string) =>
  ({ address, family: "IPv4" }) as os.NetworkInterfaceInfo;
const interfaces = {
  en0: [iface("10.0.0.201")],
  utun4: [iface("100.73.93.113")],
  lo0: [iface("127.0.0.1")],
};
const policy: AccessPolicy = {
  bound: ["127.0.0.1", "100.73.93.113"],
  extraHosts: [],
};

describe("where AgentOS listens", () => {
  it("finds Tailscale addresses and skips Wi-Fi", () => {
    expect(tailscaleAddresses(interfaces)).toEqual(["100.73.93.113"]);
    expect(bindAddresses(undefined, interfaces)).toEqual([
      "127.0.0.1",
      "100.73.93.113",
    ]);
  });

  it("honours an explicit opt-in", () => {
    expect(bindAddresses("0.0.0.0", interfaces)).toEqual(["0.0.0.0"]);
  });
});

describe("host header (DNS rebinding)", () => {
  it("accepts loopback, the Tailscale IP and *.ts.net names", () => {
    for (const h of [
      "localhost:3011",
      "127.0.0.1:3011",
      "[::1]:3011",
      "100.73.93.113:3011",
      "mac.taila1a5b9.ts.net:3011",
    ]) {
      expect(hostAllowed(h, policy)).toBe(true);
    }
  });

  it("refuses the Wi-Fi address and foreign names", () => {
    expect(hostAllowed("10.0.0.201:3011", policy)).toBe(false);
    expect(hostAllowed("evil.example:3011", policy)).toBe(false);
    expect(hostAllowed(undefined, policy)).toBe(false);
  });
});

describe("requests from web pages", () => {
  const base = { host: "127.0.0.1:3011", url: "/api/exec", method: "POST" };

  it("refuses another site's page posting to the API", () => {
    expect(
      requestAllowed({ ...base, origin: "https://evil.example" }, policy)
    ).toBe(false);
    expect(requestAllowed({ ...base, origin: "null" }, policy)).toBe(false);
    expect(
      requestAllowed(
        { ...base, method: "GET", fetchSite: "cross-site" },
        policy
      )
    ).toBe(false);
  });

  it("allows AgentOS's own page and non-browser callers", () => {
    expect(
      requestAllowed({ ...base, origin: "http://100.73.93.113:3011" }, policy)
    ).toBe(true);
    expect(requestAllowed(base, policy)).toBe(true); // curl, aos
    expect(originAllowed(undefined, policy)).toBe(true);
  });

  it("lets LumifyHub's approve page navigate back to the callback only", () => {
    const back = {
      host: "127.0.0.1:3011",
      method: "GET",
      fetchSite: "cross-site",
      fetchMode: "navigate",
    };
    expect(
      requestAllowed(
        { ...back, url: "/api/lumifyhub/callback?code=c&state=s" },
        policy
      )
    ).toBe(true);
    // A fetch from another page, not a navigation
    expect(
      requestAllowed(
        { ...back, url: "/api/lumifyhub/callback", fetchMode: "cors" },
        policy
      )
    ).toBe(false);
    // Any other path, or a POST, is still refused
    expect(
      requestAllowed({ ...back, url: "/api/lumifyhub/token" }, policy)
    ).toBe(false);
    expect(
      requestAllowed(
        { ...back, url: "/api/exec?x=/api/lumifyhub/callback" },
        policy
      )
    ).toBe(false);
    expect(
      requestAllowed(
        { ...back, method: "POST", url: "/api/lumifyhub/callback" },
        policy
      )
    ).toBe(false);
  });

  it("guards the terminal WebSocket the same way", () => {
    expect(
      upgradeAllowed(
        { host: "127.0.0.1:3011", origin: "https://evil.example" },
        policy
      )
    ).toBe(false);
    expect(
      upgradeAllowed(
        { host: "127.0.0.1:3011", origin: "http://localhost:3011" },
        policy
      )
    ).toBe(true);
  });
});
