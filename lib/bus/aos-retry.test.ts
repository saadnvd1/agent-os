import http from "http";
import path from "path";
import { execFile } from "child_process";
import type { AddressInfo } from "net";
import { describe, expect, it } from "vitest";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

function serve(handler: Handler, port = 0) {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push(`${req.method} ${req.url} ${body}`);
      handler(req, res);
    });
  });
  return new Promise<{ server: http.Server; seen: string[]; port: number }>(
    (resolve) =>
      server.listen(port, "127.0.0.1", () =>
        resolve({
          server,
          seen,
          port: (server.address() as AddressInfo).port,
        })
      )
  );
}

// Port 2 is privileged and unused, so nothing can take it and a connection to
// it is refused: the shape of a server that is down.
const DOWN = 2;

// Only the test that brings the server up late needs a port it can bind later.
async function freePort() {
  const { server, port } = await serve(() => {});
  await new Promise((r) => server.close(r));
  return port;
}

const json = (res: http.ServerResponse, status: number, body: object) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

function aos(args: string[], port: number, seconds: string) {
  const env = { ...process.env };
  delete env.AGENTOS_TOKEN;
  return new Promise<{ code: number; out: string; err: string; ms: number }>(
    (resolve) => {
      const t = Date.now();
      execFile(
        process.execPath,
        [path.join(process.cwd(), "bin/aos"), ...args],
        {
          env: {
            ...env,
            AGENTOS_URL: `http://127.0.0.1:${port}`,
            AGENTOS_SESSION_ID: "me",
            AOS_RETRY_SECONDS: seconds,
          },
        },
        (err, out, errOut) =>
          resolve({
            code: err ? Number(err.code ?? 1) : 0,
            out: String(out),
            err: String(errOut),
            ms: Date.now() - t,
          })
      );
    }
  );
}

const RESTARTING = /AgentOS is restarting, retrying/g;
const delivered = (res: http.ServerResponse) =>
  json(res, 200, {
    message: { toName: "peer" },
    delivery: { state: "delivered" },
  });

describe("aos through an AgentOS restart", () => {
  it("succeeds when the server comes up partway through the retries", async () => {
    const port = await freePort();
    const run = aos(["send", "peer", "hi"], port, "15");
    await new Promise((r) => setTimeout(r, 1500));
    const s = await serve((_, res) => delivered(res), port);
    try {
      const r = await run;
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/delivered to peer/);
      expect(r.err.match(RESTARTING)).toHaveLength(1);
      expect(s.seen).toHaveLength(1);
      expect(s.seen[0]).toContain('"body":"hi"');
    } finally {
      s.server.close();
    }
  }, 20_000);

  it("does not retry a 4xx", async () => {
    const s = await serve((_, res) => json(res, 400, { error: "No session" }));
    try {
      const r = await aos(["send", "peer", "hi"], s.port, "10");
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/aos: No session/);
      expect(r.err).not.toMatch(RESTARTING);
      expect(s.seen).toHaveLength(1);
    } finally {
      s.server.close();
    }
  });

  it("fails as before when the window runs out", async () => {
    const port = DOWN;
    const r = await aos(["peers"], port, "1");
    expect(r.code).toBe(1);
    expect(r.err).toContain(
      `aos: can't reach AgentOS at http://127.0.0.1:${port}`
    );
    expect(r.err.match(RESTARTING)).toHaveLength(1);
  });

  it("does not retry an inbox read whose response was lost", async () => {
    const s = await serve((req) => req.socket.destroy());
    try {
      const r = await aos(["inbox"], s.port, "5");
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/can't reach AgentOS/);
      expect(s.seen).toHaveLength(1);
    } finally {
      s.server.close();
    }
  });

  it("does not wait when AOS_RETRY_SECONDS is 0", async () => {
    const port = DOWN;
    const r = await aos(["peers"], port, "0");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/can't reach AgentOS/);
    expect(r.err).not.toMatch(RESTARTING);
  });

  it("does not re-send a write whose connection dropped", async () => {
    const s = await serve((req) => req.socket.destroy());
    try {
      const r = await aos(["send", "peer", "hi"], s.port, "5");
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/can't reach AgentOS/);
      expect(s.seen).toHaveLength(1);
    } finally {
      s.server.close();
    }
  });

  it("retries a read through a proxy's bare 503", async () => {
    let n = 0;
    const s = await serve((_, res) => {
      if (++n <= 2) {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("starting");
      } else json(res, 200, { peers: [] });
    });
    try {
      const r = await aos(["peers"], s.port, "15");
      expect(r.code).toBe(0);
      expect(s.seen).toHaveLength(3);
    } finally {
      s.server.close();
    }
  }, 20_000);

  it("treats AgentOS's own 503 as a real answer", async () => {
    const s = await serve((_, res) => json(res, 503, { error: "gh missing" }));
    try {
      const r = await aos(["peers"], s.port, "10");
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/gh missing/);
      expect(s.seen).toHaveLength(1);
    } finally {
      s.server.close();
    }
  });
});
