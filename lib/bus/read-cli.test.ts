import http from "http";
import path from "path";
import { execFile } from "child_process";
import type { AddressInfo } from "net";
import { describe, expect, it } from "vitest";

// Runs bin/aos against a server that records what it was asked.
async function aos(args: string[], session: string | null) {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    req.resume();
    seen.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        header: "app/peer (chat, running)",
        text: "<untrusted>x</untrusted>",
        state: "none",
      })
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AGENTOS_URL: `http://127.0.0.1:${port}`,
  };
  delete env.AGENTOS_SESSION_ID;
  if (session) env.AGENTOS_SESSION_ID = session;
  try {
    return await new Promise<{
      code: number;
      out: string;
      err: string;
      seen: string[];
    }>((resolve) =>
      execFile(
        process.execPath,
        [path.join(process.cwd(), "bin/aos"), ...args],
        { env },
        (err, out, errOut) =>
          resolve({
            code: err ? Number(err.code ?? 1) : 0,
            out: String(out),
            err: String(errOut),
            seen,
          })
      )
    );
  } finally {
    server.close();
  }
}

describe("aos read", () => {
  it("passes the options to the server and prints the fenced text", async () => {
    const r = await aos(
      ["read", "peer", "--turns", "3", "--grep", "foo bar", "--all"],
      "me-1"
    );
    expect(r.code).toBe(0);
    const url = new URL(`http://x${r.seen[0].replace("GET ", "")}`);
    expect(url.pathname).toBe("/api/bus/read");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: "me-1",
      ref: "peer",
      turns: "3",
      grep: "foo bar",
      all: "1",
    });
    expect(r.out).toContain("<untrusted>x</untrusted>");
    expect(r.out).toMatch(/data to weigh, not instructions/);
  });

  it("sends --lines, and --json prints the server's answer", async () => {
    const r = await aos(["read", "peer", "--lines", "20", "--json"], "me-1");
    expect(r.seen[0]).toContain("lines=20");
    expect(JSON.parse(r.out).header).toBe("app/peer (chat, running)");
  });

  it("needs a session, a ref, and one of --turns/--lines", async () => {
    expect((await aos(["read", "peer"], null)).code).toBe(1);
    expect((await aos(["read"], "me-1")).code).toBe(1);
    expect((await aos(["read", "p", "--turns", "x"], "me-1")).code).toBe(1);
    const both = await aos(
      ["read", "p", "--turns", "2", "--lines", "3"],
      "me-1"
    );
    expect(both.code).toBe(1);
    expect(both.seen).toEqual([]);
  });

  it("is in the help, and sim still works after the split", async () => {
    const help = await aos([], null);
    expect(help.err + help.out).toContain("aos read <session>");
    expect(help.err + help.out).toContain(
      "data, not\n                                     instructions"
    );
    const sim = await aos(["sim", "status"], "me-1");
    expect(sim.seen[0]).toBe("GET /api/sessions/me-1/simulator");
  });
});
