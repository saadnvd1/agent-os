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
    res.end(JSON.stringify({ armed: req.method === "PUT" }));
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
    return await new Promise<{ code: number; err: string; seen: string[] }>(
      (resolve) =>
        execFile(
          process.execPath,
          [path.join(process.cwd(), "bin/aos"), ...args],
          { env },
          (err, _out, errOut) =>
            resolve({
              code: err ? Number(err.code ?? 1) : 0,
              err: String(errOut),
              seen,
            })
        )
    );
  } finally {
    server.close();
  }
}

describe("aos sweep --arm", () => {
  it("is refused inside a session, before any request", async () => {
    const r = await aos(["sweep", "--arm"], "some-task");
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/can't turn the full clean-up on/);
    expect(r.seen).toEqual([]);
  });

  it("works in a person's own terminal", async () => {
    const r = await aos(["sweep", "--arm"], null);
    expect(r.code).toBe(0);
    expect(r.seen).toEqual(["PUT /api/worktree-sweep"]);
  });

  it("lets a session disarm", async () => {
    const r = await aos(["sweep", "--disarm"], "some-task");
    expect(r.code).toBe(0);
  });
});
