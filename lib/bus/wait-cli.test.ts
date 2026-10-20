import http from "http";
import path from "path";
import { execFile } from "child_process";
import type { AddressInfo } from "net";
import { describe, expect, it } from "vitest";

// Runs bin/aos against a server that records what it was asked.
async function aos(args: string[], reply: object = {}) {
  const seen: { url: string; body: unknown }[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push({ url: String(req.url), body: raw ? JSON.parse(raw) : null });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AGENTOS_URL: `http://127.0.0.1:${port}`,
    AGENTOS_SESSION_ID: "me-session",
  };
  try {
    return await new Promise<{
      code: number;
      out: string;
      err: string;
      seen: typeof seen;
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

const sent = {
  message: { id: 41, toName: "builder" },
  delivery: { state: "delivered" },
};

describe("aos send --await / --reply", () => {
  it("posts await and timeout and says to end the turn", async () => {
    const r = await aos(
      ["send", "builder", "--await", "--timeout", "10m", "is it", "ready?"],
      { ...sent, wait: { id: 1, deadline: Date.now() + 600_000 } }
    );
    expect(r.code).toBe(0);
    expect(r.seen[0].url).toBe("/api/bus/send");
    expect(r.seen[0].body).toEqual({
      from: "me-session",
      to: "builder",
      body: "is it ready?",
      await: true,
      timeout: "10m",
    });
    expect(r.out).toContain("waiting for builder's reply (up to 10m)");
    expect(r.out).toContain("end your turn");
  });

  it("posts --reply as a message id", async () => {
    const r = await aos(["send", "builder", "--reply", "12", "yes"], sent);
    expect(r.seen[0].body).toMatchObject({ replyTo: 12, body: "yes" });
    expect(r.seen[0].body).not.toHaveProperty("await");
  });

  it("reads flags after the message as message text", async () => {
    const r = await aos(
      ["send", "builder", "use", "--await", "carefully"],
      sent
    );
    expect(r.seen[0].body).toMatchObject({ body: "use --await carefully" });
    expect(r.seen[0].body).not.toHaveProperty("await");
  });

  it("says why it isn't waiting", async () => {
    const r = await aos(["send", "builder", "--await", "hi"], {
      ...sent,
      wait: { notWaiting: "it wasn't delivered" },
    });
    expect(r.out).toContain("not waiting: it wasn't delivered");
  });

  it("refuses --timeout without --await and a bad --reply, before any request", async () => {
    const a = await aos(["send", "builder", "--timeout", "5m", "hi"]);
    expect(a.code).toBe(1);
    expect(a.err).toContain("--timeout goes with --await");
    const b = await aos(["send", "builder", "--reply", "x", "hi"]);
    expect(b.err).toContain("--reply takes a message id");
    expect(a.seen).toHaveLength(0);
    expect(b.seen).toHaveLength(0);
  });
});

describe("aos wait", () => {
  it("registers the wait and returns", async () => {
    const r = await aos(
      ["wait", "builder", "--until", "merged", "--timeout", "2h"],
      { id: 3, deadline: Date.now() + 7_200_000, target: "builder" }
    );
    expect(r.code).toBe(0);
    expect(r.seen[0]).toEqual({
      url: "/api/bus/wait",
      body: {
        from: "me-session",
        to: "builder",
        until: "merged",
        timeout: "2h",
      },
    });
    expect(r.out).toContain(
      "waiting on builder for its PR to merge (up to 120m)"
    );
  });

  it("prints a wait that already holds", async () => {
    const r = await aos(["wait", "builder", "--until", "idle"], {
      already: "builder is idle now",
    });
    expect(r.out).toContain("not waiting: builder is idle now");
  });

  it("refuses a missing or unknown --until locally", async () => {
    const a = await aos(["wait", "builder"]);
    const b = await aos(["wait", "builder", "--until", "soon"]);
    expect(a.code).toBe(1);
    expect(b.code).toBe(1);
    expect(a.seen.length + b.seen.length).toBe(0);
  });
});
