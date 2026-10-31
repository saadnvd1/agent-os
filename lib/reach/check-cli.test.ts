import http from "http";
import net from "net";
import { afterEach, describe, expect, it } from "vitest";
import { runCheckCli, type CheckCliDeps } from "./check-cli";
import { CAUSES } from "./classify";
import type { ReachReport } from "./types";

const servers: (http.Server | net.Server)[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise((r) => s.close(r)))
  );
});

async function listen(s: http.Server | net.Server): Promise<number> {
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return (s.address() as net.AddressInfo).port;
}

async function freePort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as net.AddressInfo).port;
  await new Promise((r) => s.close(r));
  return port;
}

async function run(
  port: number,
  args: string[] = [],
  over: Partial<CheckCliDeps> = {}
) {
  const lines: string[] = [];
  const code = await runCheckCli(args, {
    base: `http://127.0.0.1:${port}`,
    fetch,
    out: (l) => lines.push(l),
    holder: async () => "python3",
    serviceInstalled: () => true,
    reportMs: 500,
    probeMs: 500,
    ...over,
  });
  return { code, text: lines.join("\n") };
}

const REPORT: ReachReport = {
  status: "warn",
  url: "http://192.168.1.20:3011",
  checkedAt: "2026-10-31T12:00:00.000Z",
  findings: [
    {
      route: "lan",
      status: "ok",
      needs: "nothing",
      title: "Reachable on this Wi-Fi",
      fix: "",
      url: "http://192.168.1.20:3011",
    },
    {
      route: "connect",
      status: "fail",
      cause: "connect-denied",
      needs: "you",
      title: CAUSES["connect-denied"].title,
      fix: "agent-os connect",
      guide:
        "https://example.test/reachability.md#connect-refused-this-machine",
    },
  ],
};

describe("agent-os check", () => {
  it("prints the server's report, and exits by its status", async () => {
    let asked = "";
    const port = await listen(
      http.createServer((req, res) => {
        asked = req.url ?? "";
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(REPORT));
      })
    );
    const { code, text } = await run(port, ["--via", "lan"]);
    expect(asked).toBe("/api/reach?fresh=&want=lan");
    expect(code).toBe(1);
    expect(text).toContain(
      "✓ Reachable on this Wi-Fi: http://192.168.1.20:3011"
    );
    expect(text).toContain(`✗ ${CAUSES["connect-denied"].title}`);
    expect(text).toContain("→ agent-os connect");
  });

  it("--json prints the report as is", async () => {
    const port = await listen(
      http.createServer((_q, res) =>
        res.end(JSON.stringify({ ...REPORT, status: "ok" }))
      )
    );
    const { code, text } = await run(port, ["--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(text).findings).toHaveLength(2);
  });

  it("nothing on the port: service-down", async () => {
    const { code, text } = await run(await freePort(), ["--json"]);
    expect(code).toBe(2);
    expect(JSON.parse(text).findings[0]).toMatchObject({
      cause: "service-down",
      fix: "agent-os start",
    });
  });

  it("nothing on the port and no service installed: enable it", async () => {
    const { text } = await run(await freePort(), ["--json"], {
      serviceInstalled: () => false,
    });
    expect(JSON.parse(text).findings[0].fix).toBe("agent-os enable");
  });

  it("AgentOS answers its probe but not the report: service-stuck", async () => {
    const port = await listen(
      http.createServer((req, res) => {
        if (req.url === "/api/reach/probe")
          return res.end(JSON.stringify({ ok: true, boot: "abc" }));
        // Hangs on the report.
      })
    );
    const { code, text } = await run(port, ["--json"]);
    expect(code).toBe(2);
    expect(JSON.parse(text).findings[0]).toMatchObject({
      cause: "service-stuck",
      fix: "agent-os restart",
    });
  });

  it("another web server on the port: port-taken, with its program", async () => {
    const port = await listen(
      http.createServer((_q, res) => res.end("<html>hello</html>"))
    );
    const { text } = await run(port, ["--json"]);
    expect(JSON.parse(text).findings[0]).toMatchObject({
      cause: "port-taken",
      title: `${CAUSES["port-taken"].title} (python3)`,
    });
  });

  it("something that isn't HTTP on the port: port-taken; an odd program name is dropped", async () => {
    const port = await listen(net.createServer((s) => s.destroy()));
    const { text } = await run(port, ["--json"], {
      holder: async () => "evil name; rm -rf",
    });
    expect(JSON.parse(text).findings[0]).toMatchObject({
      cause: "port-taken",
      title: CAUSES["port-taken"].title,
    });
  });

  it("refuses an unknown --via", async () => {
    const { code, text } = await run(await freePort(), [
      "--via",
      "carrier-pigeon",
    ]);
    expect(code).toBe(2);
    expect(text).toContain("--via takes one of");
  });
});
