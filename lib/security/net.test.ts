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
  utun4: [iface("100.64.0.1")],
  lo0: [iface("127.0.0.1")],
};
const policy: AccessPolicy = {
  bound: ["127.0.0.1", "100.64.0.1"],
  extraHosts: [],
};

describe("where AgentOS listens", () => {
  it("finds Tailscale addresses and skips Wi-Fi", () => {
    expect(tailscaleAddresses(interfaces)).toEqual(["100.64.0.1"]);
    expect(bindAddresses(undefined, interfaces)).toEqual([
      "127.0.0.1",
      "100.64.0.1",
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
      "100.64.0.1:3011",
      "laptop.example.ts.net:3011",
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
      requestAllowed({ ...base, origin: "http://100.64.0.1:3011" }, policy)
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

  it("lets an MCP server's sign-in navigate back to its callback only", () => {
    const back = {
      host: "127.0.0.1:3011",
      method: "GET",
      fetchSite: "cross-site",
      fetchMode: "navigate",
      url: "/api/mcp-auth/callback?code=c&state=s",
    };
    expect(requestAllowed(back, policy)).toBe(true);
    expect(requestAllowed({ ...back, fetchMode: "cors" }, policy)).toBe(false);
    expect(requestAllowed({ ...back, method: "POST" }, policy)).toBe(false);
    expect(
      requestAllowed({ ...back, url: "/api/sessions/x/mcp-auth" }, policy)
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

describe("Origin of WebSocket upgrades and API writes, under each bind", () => {
  const mine = "m-0123456789abcdef.runagentos.com";
  const theirs = "m-fedcba9876543210.runagentos.com";
  const modes: [string, AccessPolicy][] = [
    ["loopback and tailnet", { ...policy, machineHost: () => mine }],
    [
      "AGENTOS_BIND=0.0.0.0",
      { bound: ["0.0.0.0"], extraHosts: [], machineHost: () => mine },
    ],
    [
      "AGENTOS_BIND=127.0.0.1,100.64.0.1",
      {
        bound: ["127.0.0.1", "100.64.0.1"],
        extraHosts: [mine],
        machineHost: () => mine,
      },
    ],
  ];
  const upgrade = (host: string, origin: string | undefined, p: AccessPolicy) =>
    upgradeAllowed({ host, origin }, p);
  const post = (host: string, origin: string, p: AccessPolicy) =>
    requestAllowed({ host, origin, url: "/api/exec", method: "POST" }, p);

  for (const [mode, p] of modes) {
    describe(mode, () => {
      it("refuses another Connect machine's page", () => {
        expect(upgrade(mine, `https://${theirs}`, p)).toBe(false);
        expect(post(mine, `https://${theirs}`, p)).toBe(false);
        // Even when the request names that machine (a wildcard bind)
        expect(upgrade(theirs, `https://${theirs}`, p)).toBe(false);
      });

      it("refuses foreign, opaque and malformed origins", () => {
        for (const o of [
          "https://evil.example",
          "null",
          "not a url",
          "https://runagentos.com",
          "https://other.example.ts.net",
        ]) {
          expect(upgrade("127.0.0.1:3011", o, p)).toBe(false);
        }
      });

      it("refuses a name rebound to this machine", () => {
        expect(
          upgrade("evil.example:3011", "http://evil.example:3011", p)
        ).toBe(false);
      });

      it("allows this machine's own origins", () => {
        expect(upgrade(mine, `https://${mine}`, p)).toBe(true);
        expect(post(mine, `https://${mine}`, p)).toBe(true);
        expect(upgrade("127.0.0.1:3011", "http://localhost:3011", p)).toBe(
          true
        );
        expect(upgrade("100.64.0.1:3011", "http://100.64.0.1:3011", p)).toBe(
          true
        );
        expect(
          upgrade(
            "laptop.example.ts.net:3011",
            "https://laptop.example.ts.net:3443",
            p
          )
        ).toBe(true);
      });

      it("allows clients that send no Origin (the app, peers, curl)", () => {
        expect(upgrade(mine, undefined, p)).toBe(true);
        expect(upgrade("127.0.0.1:3011", undefined, p)).toBe(true);
      });
    });
  }

  it("a wildcard bind admits a page served on its LAN address, only there", () => {
    const p = modes[1][1];
    expect(upgrade("10.0.0.201:3011", "http://10.0.0.201:3011", p)).toBe(true);
    expect(upgrade("10.0.0.201:3011", "http://10.0.0.99:3011", p)).toBe(false);
  });

  it("follows the Connect address as it changes", () => {
    let host: string | null = null;
    const p: AccessPolicy = { ...policy, machineHost: () => host };
    expect(upgrade("127.0.0.1:3011", `https://${mine}`, p)).toBe(false);
    host = mine;
    expect(upgrade("127.0.0.1:3011", `https://${mine}`, p)).toBe(true);
  });

  it("refuses another machine's address even when configured as a host", () => {
    const p: AccessPolicy = {
      ...policy,
      extraHosts: [theirs],
      machineHost: () => mine,
    };
    expect(upgrade("127.0.0.1:3011", `https://${theirs}`, p)).toBe(false);
  });
});

describe("tailscaleAddresses (only Tailscale's own interface)", () => {
  const v4 = (address: string) =>
    ({ address, family: "IPv4" }) as os.NetworkInterfaceInfo;
  it("ignores another VPN's 100.64/10 address", () => {
    const ifaces = {
      utun4: [v4("100.64.0.1")],
      wg0: [v4("100.90.1.2")],
      ppp0: [v4("100.100.1.1")],
    };
    expect(tailscaleAddresses(ifaces, [])).toEqual(["100.64.0.1"]);
  });
  it("trusts tailscale0 on Linux", () => {
    expect(tailscaleAddresses({ tailscale0: [v4("100.64.0.3")] }, [])).toEqual([
      "100.64.0.3",
    ]);
  });
  it("once the CLI has reported this node's IPs, only those count", () => {
    const ifaces = { utun3: [v4("100.64.0.9")], utun4: [v4("100.64.0.1")] };
    expect(tailscaleAddresses(ifaces, ["100.64.0.1"])).toEqual(["100.64.0.1"]);
  });
});
