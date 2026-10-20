import { describe, expect, it } from "vitest";
import { runLinkCli } from "./link-cli";

type Handler = (method: string, body: unknown) => [number, unknown];

function io(routes: Record<string, Handler>, typed: (string | null)[] = []) {
  const calls: string[] = [];
  const lines: string[] = [];
  return {
    calls,
    lines,
    io: {
      base: "http://127.0.0.1:1",
      out: (l: string) => lines.push(l),
      sleep: async () => {},
      ask: async (prompt: string) => {
        lines.push(prompt);
        return typed.shift() ?? null;
      },
      fetch: (async (url: string, init?: RequestInit) => {
        const path = url.replace("http://127.0.0.1:1", "");
        const method = init?.method ?? "GET";
        calls.push(`${method} ${path}`);
        const h = routes[`${method} ${path}`];
        if (!h) return new Response("{}", { status: 404 });
        const [status, json] = h(
          method,
          init?.body ? JSON.parse(String(init.body)) : null
        );
        return new Response(JSON.stringify(json), { status });
      }) as typeof fetch,
    },
  };
}

const account = {
  enrolled: true,
  entitlements: { plan: "pro", linkMachines: true, machineLimit: 10 },
  fetchedAt: 1,
  error: null,
  machines: [
    {
      id: "bbbb2222",
      name: "Spark",
      hostname: "h",
      online: true,
      lastSeenAt: null,
      version: "0.3",
      hostId: null,
      linkState: null,
    },
  ],
};
const pending = (n: number) => ({
  requests: Array.from({ length: n }, (_, i) => ({
    id: `req${i}`,
    machineId: `aaaa000${i}`,
    name: `Mac ${i}`,
    expiresAt: 0,
    attemptsLeft: 3,
  })),
});

describe("agent-os link", () => {
  it("accepts the one waiting request with its code", async () => {
    let sent: unknown;
    const t = io({
      "GET /api/peers/pending": () => [200, pending(1)],
      "POST /api/peers/pending/req0/accept": (_m, b) => {
        sent = b;
        return [200, { hostId: "h1", name: "Mac 0", confirmCode: "105733" }];
      },
    });
    expect(await runLinkCli(["accept", "482", "913"], t.io)).toBe(0);
    expect(sent).toEqual({ code: "482913" });
    expect(t.lines.join("\n")).toMatch(/type this code on Mac 0:\s+105 733/);
    expect(await runLinkCli(["accept", "482913"], t.io)).toBe(0);
    expect(sent).toEqual({ code: "482913" });
  });

  it("asks which when several machines are waiting", async () => {
    const t = io({
      "GET /api/peers/pending": () => [200, pending(2)],
      "POST /api/peers/pending/req1/accept": () => [
        403,
        { error: "That code doesn't match." },
      ],
    });
    expect(await runLinkCli(["accept", "111111"], t.io)).toBe(1);
    expect(t.lines.at(-1)).toMatch(/--from/);
    expect(
      await runLinkCli(["accept", "111111", "--from", "mac 1"], t.io)
    ).toBe(1);
    expect(t.lines.at(-1)).toMatch(/doesn't match/);
  });

  it("starts a link, shows the code, then takes the one shown back", async () => {
    let polls = 0;
    const sent: unknown[] = [];
    const link = { id: "L1", name: "Spark", code: "482913", state: "pending" };
    const t = io(
      {
        "GET /api/peers/account?refresh=1": () => [200, account],
        "POST /api/peers/link": () => [200, { link }],
        "GET /api/peers/link/L1": () => [
          200,
          { link: { ...link, state: ++polls < 3 ? "pending" : "confirm" } },
        ],
        "POST /api/peers/link/L1/confirm": (_m, b) => {
          sent.push(b);
          return sent.length === 1
            ? [403, { error: "That code doesn't match.", attemptsLeft: 2 }]
            : [200, { link: { ...link, state: "accepted" } }];
        },
      },
      ["111111", "105 733"]
    );
    expect(await runLinkCli(["spark"], t.io)).toBe(0);
    const out = t.lines.join("\n");
    expect(out).toContain("482 913");
    expect(out).toContain("2 left");
    expect(sent).toEqual([{ code: "111111" }, { code: "105 733" }]);
    expect(t.lines.at(-1)).toMatch(/Linked with Spark/);
    expect(polls).toBe(3);
  });

  it("links nothing when no code is typed back", async () => {
    const link = { id: "L1", name: "Spark", code: "482913", state: "confirm" };
    const t = io({
      "GET /api/peers/account?refresh=1": () => [200, account],
      "POST /api/peers/link": () => [200, { link }],
    });
    expect(await runLinkCli(["spark"], t.io)).toBe(1);
    expect(t.lines.at(-1)).toMatch(/nothing was linked/);
    expect(t.calls).not.toContain("POST /api/peers/link/L1/confirm");
  });

  it("says when the code expired", async () => {
    const link = { id: "L1", name: "Spark", code: "482913", state: "pending" };
    const t = io({
      "GET /api/peers/account?refresh=1": () => [200, account],
      "POST /api/peers/link": () => [200, { link }],
      "GET /api/peers/link/L1": () => [
        200,
        { link: { ...link, state: "expired" } },
      ],
    });
    expect(await runLinkCli(["Spark"], t.io)).toBe(1);
    expect(t.lines.at(-1)).toMatch(/expired/);
  });

  it("unlinks only a machine linked through Connect", async () => {
    const t = io({
      "GET /api/hosts": () => [
        200,
        {
          hosts: [
            { id: "s1", name: "Spark", kind: "ssh" },
            { id: "c1", name: "Spark", kind: "connect" },
          ],
        },
      ],
      "DELETE /api/peers/c1": () => [200, { told: true, removed: true }],
    });
    expect(await runLinkCli(["--unlink", "spark"], t.io)).toBe(0);
    expect(t.calls).toContain("DELETE /api/peers/c1");
    expect(t.calls.some((c) => c.includes("s1"))).toBe(false);
    expect(t.lines.join("\n")).toContain("on both machines");
  });

  it("lists the account and what's waiting", async () => {
    const t = io({
      "GET /api/peers/account?refresh=1": () => [200, account],
      "GET /api/peers/pending": () => [200, pending(1)],
    });
    expect(await runLinkCli([], t.io)).toBe(0);
    const out = t.lines.join("\n");
    expect(out).toContain("Spark");
    expect(out).toContain("Mac 0 wants to link here");
  });
});
