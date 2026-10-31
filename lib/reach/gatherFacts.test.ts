import { describe, expect, it, vi } from "vitest";
import {
  gatherFacts,
  notHereLabel,
  readFirewall,
  type GatherDeps,
} from "./gatherFacts";

const NOW = Date.parse("2026-10-31T12:00:00Z");

function deps(over: Partial<GatherDeps> = {}): GatherDeps {
  return {
    connect: () => ({ state: "off" }),
    connectFiles: () => ({ enabled: false }),
    tailscale: async () => ({ state: "missing" }),
    tailnetHttps: () => null,
    lan: () => ({ on: false, addresses: [] }),
    exec: async () => "",
    readFile: () => null,
    probe: vi.fn(async () => ({ kind: "ok" as const })),
    platform: "linux",
    nodePath: "/usr/bin/node",
    port: 3011,
    now: () => NOW,
    ...over,
  };
}

describe("readFirewall", () => {
  const mac = (blockAll: string, app: string) =>
    readFirewall(
      deps({
        platform: "darwin",
        exec: async (_f, args) =>
          args[0] === "--getblockall" ? blockAll : app,
      })
    );

  it("macOS blocking everything: blocks", async () => {
    expect(await mac("Firewall has block all state set to enabled.", "")).toBe(
      "blocks"
    );
    expect(await mac("Block all ENABLED!", "")).toBe("blocks");
  });

  it("macOS with node blocked: blocks", async () => {
    expect(
      await mac(
        "Block all DISABLED!",
        "The application /usr/bin/node is blocked"
      )
    ).toBe("blocks");
  });

  it("macOS with node permitted: off", async () => {
    expect(
      await mac(
        "Firewall has block all state set to disabled.",
        "The application /usr/bin/node is permitted"
      )
    ).toBe("off");
  });

  it("macOS tool missing: unknown", async () => {
    const d = deps({
      platform: "darwin",
      exec: async () => Promise.reject(new Error("ENOENT")),
    });
    expect(await readFirewall(d)).toBe("unknown");
  });

  const linux = (conf: string | null, rules: string | null) =>
    readFirewall(
      deps({
        readFile: (p) => (p.endsWith("ufw.conf") ? conf : rules),
      })
    );

  it("ufw off or absent: off", async () => {
    expect(await linux(null, null)).toBe("off");
    expect(await linux("ENABLED=no\n", null)).toBe("off");
  });

  it("ufw on with rules we can't read: blocks", async () => {
    expect(await linux("# comment\nENABLED=yes\n", null)).toBe("blocks");
  });

  it("ufw on with AgentOS's port allowed: off", async () => {
    expect(
      await linux(
        "ENABLED=yes",
        "-A ufw-user-input -p tcp --dport 3011 -j ACCEPT"
      )
    ).toBe("off");
    expect(
      await linux(
        "ENABLED=yes",
        "-A ufw-user-input -p tcp --dport 30110 -j ACCEPT"
      )
    ).toBe("blocks");
  });
});

describe("notHereLabel", () => {
  it.each([
    ["AGENTOS_CONNECT=0", "env-off"],
    ["not a production build", "dev-build"],
    [
      "port 3121 isn't AgentOS's port 3011 (AGENTOS_CONNECT=1 overrides)",
      "wrong-port",
    ],
    ["AGENTOS_AUTH=off: never on the internet without pairing", "auth-off"],
    ["another AgentOS (pid 123) holds the tunnel", "lock"],
    ["something new", "other"],
  ])("%s → %s", (reason, label) => expect(notHereLabel(reason)).toBe(label));
});

describe("gatherFacts", () => {
  it("probes Connect only when the tunnel is up", async () => {
    const d = deps({
      connect: () => ({
        state: "connecting",
        enrolled: true,
        hostname: "m-1.example.test",
      }),
      connectFiles: () => ({ enabled: true, controlHost: "api.example.test" }),
    });
    const f = await gatherFacts(d);
    expect(d.probe).not.toHaveBeenCalled();
    expect(f.connect).toMatchObject({
      state: "connecting",
      linked: true,
      enabled: true,
    });
  });

  it("an up tunnel gets probed, and the probe lands in the facts", async () => {
    const d = deps({
      connect: () => ({
        state: "up",
        enrolled: true,
        hostname: "m-1.example.test",
      }),
      connectFiles: () => ({ enabled: true, controlHost: "api.example.test" }),
      probe: vi.fn(async () => ({ kind: "wrong-origin" as const })),
    });
    const f = await gatherFacts(d);
    expect(d.probe).toHaveBeenCalledWith(
      "m-1.example.test",
      "api.example.test"
    );
    expect(f.probe).toEqual({ kind: "wrong-origin" });
  });

  it("switched on but off with a reason: the service stopped it", async () => {
    const f = await gatherFacts(
      deps({
        connect: () => ({
          state: "off",
          enrolled: true,
          reason: "stopped by the Connect service",
        }),
        connectFiles: () => ({ enabled: true }),
      })
    );
    expect(f.connect.state).toBe("denied");
  });

  it("refused: the reason becomes a label, never text", async () => {
    const f = await gatherFacts(
      deps({
        connect: () => ({ state: "refused", reason: "AGENTOS_CONNECT=0" }),
      })
    );
    expect(f.connect).toEqual({
      state: "refused",
      linked: false,
      enabled: false,
      notHere: "env-off",
    });
  });

  it("reads the firewall only with Wi-Fi access on, and keeps the Tailscale link", async () => {
    const exec = vi.fn(async () => "Block all ENABLED!");
    const off = await gatherFacts(deps({ platform: "darwin", exec }));
    expect(exec).not.toHaveBeenCalled();
    expect(off.firewall).toBe("off");
    const on = await gatherFacts(
      deps({
        platform: "darwin",
        exec,
        lan: () => ({ on: true, addresses: ["192.168.1.20"] }),
        tailscale: async () => ({
          state: "running",
          ips: ["100.64.0.1"],
          dnsName: "box.tail.test",
          https: false,
        }),
      })
    );
    expect(on.firewall).toBe("blocks");
    expect(on.tailscale).toEqual({
      state: "running",
      url: "http://box.tail.test:3011",
    });
  });
});
