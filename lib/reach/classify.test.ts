import { describe, expect, it } from "vitest";
import { CAUSES, classifyReach, finding, SELF_HEAL_MS } from "./classify";
import {
  REACH_CAUSES,
  type ReachCause,
  type ReachFacts,
  type ReachRoute,
} from "./types";

const NOW = Date.parse("2026-10-31T12:00:00Z");
const HOST = "m-0123456789abcdef.example.test";

function facts(
  over: Partial<Omit<ReachFacts, "connect">> & {
    connect?: Partial<ReachFacts["connect"]>;
  } = {}
): ReachFacts {
  return {
    now: NOW,
    port: 3011,
    lan: { on: false, addresses: [] },
    firewall: "off",
    tailscale: { state: "missing" },
    ...over,
    connect: {
      state: "off",
      linked: false,
      enabled: false,
      ...over.connect,
    },
  };
}

const up = (
  probe: ReachFacts["probe"],
  connect: Partial<ReachFacts["connect"]> = {}
) =>
  facts({
    connect: {
      state: "up",
      linked: true,
      enabled: true,
      hostname: HOST,
      ...connect,
    },
    ...(probe && { probe }),
  });

const linked = (connect: Partial<ReachFacts["connect"]>) =>
  facts({
    connect: { linked: true, enabled: true, hostname: HOST, ...connect },
  });

const longAgo = NOW - SELF_HEAL_MS - 1;

interface Case {
  cause: ReachCause;
  facts: ReachFacts;
  want?: ReachRoute[];
  status: "warn" | "fail";
  fix: string;
}

// One case per cause. service-down, service-stuck and port-taken are named by
// the CLI when the server can't answer, so they're built with finding().
const CASES: Case[] = [
  { cause: "no-route", facts: facts(), status: "fail", fix: "agent-os setup" },
  {
    cause: "lan-off",
    facts: facts(),
    want: ["lan"],
    status: "fail",
    fix: "agent-os setup --via lan",
  },
  {
    cause: "firewall",
    facts: facts({
      lan: { on: true, addresses: ["192.168.1.20"] },
      firewall: "blocks",
    }),
    status: "warn",
    fix: CAUSES.firewall.fix,
  },
  {
    cause: "tailscale-missing",
    facts: facts(),
    want: ["tailscale"],
    status: "fail",
    fix: CAUSES["tailscale-missing"].fix,
  },
  {
    cause: "tailscale-logged-out",
    facts: facts({ tailscale: { state: "logged-out" } }),
    want: ["tailscale"],
    status: "fail",
    fix: "sudo tailscale up",
  },
  {
    cause: "connect-not-linked",
    facts: facts(),
    want: ["connect"],
    status: "fail",
    fix: "agent-os connect",
  },
  {
    cause: "connect-off",
    facts: facts({ connect: { linked: true, enabled: false, hostname: HOST } }),
    status: "fail",
    fix: "agent-os connect --on",
  },
  {
    cause: "connect-not-here",
    facts: linked({ state: "refused", notHere: "lock" }),
    status: "fail",
    fix: CAUSES["connect-not-here"].alt!.lock,
  },
  {
    cause: "connect-denied",
    facts: linked({ state: "denied" }),
    status: "fail",
    fix: "agent-os connect",
  },
  {
    cause: "connector-not-ready",
    facts: linked({ state: "error", stage: "connector", downSince: longAgo }),
    status: "fail",
    fix: "agent-os logs",
  },
  {
    cause: "relay-down",
    facts: linked({ state: "error", stage: "service", downSince: longAgo }),
    status: "fail",
    fix: "agent-os logs",
  },
  {
    cause: "origin-down",
    facts: up({ kind: "edge", status: 502, tunnel: false }),
    status: "fail",
    fix: "agent-os restart",
  },
  {
    cause: "wrong-origin",
    facts: up({ kind: "wrong-origin" }),
    status: "fail",
    fix: CAUSES["wrong-origin"].fix,
  },
  {
    cause: "dns",
    facts: up({ kind: "dns", scope: "host" }, { downSince: longAgo }),
    status: "fail",
    fix: CAUSES.dns.fix,
  },
  {
    cause: "offline",
    facts: up({ kind: "offline" }),
    status: "fail",
    fix: CAUSES.offline.fix,
  },
  {
    cause: "certificate",
    facts: up({ kind: "tls", skewed: true }),
    status: "fail",
    fix: CAUSES.certificate.alt!.clock,
  },
];

const CLI_CAUSES: ReachCause[] = [
  "service-down",
  "service-stuck",
  "port-taken",
];

describe("classifyReach: one case per cause", () => {
  it.each(CASES)("$cause", ({ cause, facts: f, want, status, fix }) => {
    const r = classifyReach(f, want);
    const hit = r.findings.find((x) => x.cause === cause);
    expect(hit, JSON.stringify(r.findings)).toBeDefined();
    expect(hit!.status).toBe(status);
    expect(hit!.fix).toBe(fix);
    expect(hit!.needs).toBe("you");
    expect(hit!.guide).toMatch(/reachability\.md#[a-z0-9-]+$/);
    if (cause !== "no-route") expect(hit!.route).toBeDefined();
  });

  it.each(CLI_CAUSES)("%s (named by the CLI)", (cause) => {
    const f = finding(cause, "fail");
    expect(f.title).toBe(CAUSES[cause].title);
    expect(f.fix).toBe(CAUSES[cause].fix);
  });

  it("every cause has a case", () => {
    const covered = new Set([...CASES.map((c) => c.cause), ...CLI_CAUSES]);
    expect(REACH_CAUSES.filter((c) => !covered.has(c))).toEqual([]);
  });

  it("every cause has a title and a one-line fix", () => {
    for (const c of REACH_CAUSES) {
      const { title, fix, alt } = CAUSES[c];
      for (const line of [title, fix, ...Object.values(alt ?? {})]) {
        expect(line.trim()).not.toBe("");
        expect(line).not.toContain("\n");
      }
    }
  });
});

describe("classifyReach: overall status", () => {
  it("reachable everywhere: ok, with the best link (Connect first)", () => {
    const f = up({ kind: "ok" });
    f.lan = { on: true, addresses: ["192.168.1.20"] };
    const r = classifyReach(f);
    expect(r.status).toBe("ok");
    expect(r.url).toBe(`https://${HOST}`);
    expect(r.findings.map((x) => x.url)).toEqual([
      `https://${HOST}`,
      "http://192.168.1.20:3011",
    ]);
  });

  it("one route broken, another working: warn, and the working link", () => {
    const f = linked({ state: "denied" });
    f.tailscale = { state: "running", url: "http://box.tail.test:3011" };
    const r = classifyReach(f);
    expect(r.status).toBe("warn");
    expect(r.url).toBe("http://box.tail.test:3011");
  });

  it("nothing works: fail", () => {
    const r = classifyReach(linked({ state: "denied" }));
    expect(r.status).toBe("fail");
    expect(r.url).toBeUndefined();
  });

  it("Tailscale installed but logged out isn't a route unless wanted", () => {
    const r = classifyReach(facts({ tailscale: { state: "logged-out" } }));
    expect(r.findings.map((x) => x.cause)).toEqual(["no-route"]);
  });

  it("a firewall reading is never more than a warning", () => {
    const r = classifyReach(
      facts({ lan: { on: true, addresses: ["10.0.0.2"] }, firewall: "blocks" })
    );
    expect(r.status).toBe("warn");
    expect(r.findings[0].status).toBe("warn");
  });

  it("a certificate problem without clock skew is a warning: it may be this network", () => {
    const r = classifyReach(up({ kind: "tls", skewed: false }));
    expect(r.findings[0]).toMatchObject({
      status: "warn",
      fix: CAUSES.certificate.fix,
    });
  });

  it("this computer unable to look up any name is a warning", () => {
    const r = classifyReach(up({ kind: "dns", scope: "all" }));
    expect(r.findings[0]).toMatchObject({
      status: "warn",
      fix: CAUSES.dns.alt!.all,
    });
  });
});

describe("classifyReach: causes AgentOS retries by itself", () => {
  const healing: [string, ReachFacts][] = [
    [
      "connecting for 20s",
      linked({ state: "connecting", downSince: NOW - 20_000 }),
    ],
    [
      "connector download failing",
      linked({ state: "error", stage: "connector", downSince: NOW - 60_000 }),
    ],
    [
      "Connect service failing",
      linked({ state: "error", stage: "service", downSince: NOW - 60_000 }),
    ],
    [
      "edge has no tunnel yet",
      up(
        { kind: "edge", status: 530, tunnel: true },
        { downSince: NOW - 1000 }
      ),
    ],
    ["probe timed out", up({ kind: "timeout" })],
  ];

  it.each(healing)("%s: nothing to do, a warning", (_, f) => {
    const r = classifyReach(f);
    expect(r.status).toBe("warn");
    expect(r.findings[0]).toMatchObject({
      status: "warn",
      needs: "nothing",
      fix: "",
    });
  });

  it.each(healing)("%s for over 5 minutes: yours, and a failure", (_, f) => {
    const r = classifyReach({
      ...f,
      connect: { ...f.connect, downSince: longAgo },
    });
    expect(r.status).toBe("fail");
    expect(r.findings[0]).toMatchObject({ status: "fail", needs: "you" });
    expect(r.findings[0].fix).not.toBe("");
  });
});

describe("classifyReach: labels only", () => {
  it("no raw text from the facts reaches a finding", () => {
    const secret = "tskey-auth-SECRET123";
    const f = linked({ state: "refused", notHere: "other" });
    // A stray field a careless gatherer might pass through.
    (f.connect as Record<string, unknown>).reason = `token ${secret}`;
    const out = JSON.stringify(classifyReach(f));
    expect(out).not.toContain(secret);
    expect(out).toContain(CAUSES["connect-not-here"].alt!.other);
  });

  it("a program name only ever lands in a port-taken title", () => {
    const f = finding("port-taken", "fail", { detail: "python3" });
    expect(f.title).toBe(`${CAUSES["port-taken"].title} (python3)`);
    expect(f.fix).toBe(CAUSES["port-taken"].fix);
  });
});
