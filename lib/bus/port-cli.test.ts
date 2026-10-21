import http from "http";
import path from "path";
import { execFile } from "child_process";
import type { AddressInfo } from "net";
import { describe, expect, it } from "vitest";

// Runs bin/aos against a server that records what it was asked.
async function aos(
  args: string[],
  session: string | null,
  reply: object = { text: "PORT=3101 is free.", blocked: false }
) {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push(`${req.method} ${req.url} ${body}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(reply));
    });
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

describe("aos port", () => {
  it("asks for the caller's ports and prints the answer", async () => {
    const r = await aos(["port"], "me-1");
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("PORT=3101 is free.");
    expect(r.seen).toEqual(['POST /api/bus/ports {"from":"me-1"}']);
  });

  it("passes a name or port, and exits 3 when the port is someone else's", async () => {
    const r = await aos(["port", "3000"], "me-1", {
      text: "3000 is held by pid 9.",
      blocked: true,
    });
    expect(r.code).toBe(3);
    expect(r.out).toContain("3000 is held by pid 9.");
    expect(r.seen).toEqual([
      'POST /api/bus/ports {"from":"me-1","target":"3000"}',
    ]);
  });

  it("runs only inside a session", async () => {
    const r = await aos(["port"], null);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/not inside an AgentOS session/);
    expect(r.seen).toEqual([]);
  });
});
