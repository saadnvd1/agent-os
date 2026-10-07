import http from "http";
import path from "path";
import { execFile } from "child_process";
import type { AddressInfo } from "net";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const moveTask = vi.fn();
vi.mock("@/lib/tasks", () => ({ moveTask }));
type Row = { id: string; name: string; project_id: string };
const sessions: Record<string, Row> = {
  "fix-it": { id: "t1", name: "Fix it", project_id: "p1" },
  elsewhere: { id: "t2", name: "Elsewhere", project_id: "p2" },
  me: { id: "me", name: "Me", project_id: "p1" },
};
vi.mock("@/lib/bus", () => ({
  resolveSession: (ref: string) => {
    if (!sessions[ref]) throw new Error(`No session "${ref}"`);
    return sessions[ref];
  },
}));
vi.mock("@/lib/done", () => ({
  getDoneTarget: (id: string) => {
    if (!sessions[id]) throw new Error("Session not found");
    return sessions[id];
  },
}));
// The scope follows whoever it's given, so the route has to pass the caller.
vi.mock("@/lib/done/bulk", () => ({
  scopeOf: (s: Row) => ({ projectId: s.project_id }),
  inScope: (scope: { projectId: string }, s: Row) =>
    s.project_id === scope.projectId,
}));
vi.mock("@/lib/hosts", () => ({
  hostIdNamed: (ref: string) => {
    if (ref === "here") return "local";
    if (ref === "devbox") return "h1";
    throw new Error(`No machine named "${ref}"`);
  },
  getHost: (id: string) => ({ name: id === "h1" ? "devbox" : "This machine" }),
}));

const { POST } = await import("@/app/api/bus/move/route");
const call = (body: object) =>
  POST(
    new NextRequest("http://x/api/bus/move", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );

// Runs bin/aos against a server that answers with `reply`.
async function aos(
  args: string[],
  reply: { status: number; body: object }
): Promise<{ sent: unknown; code: number; out: string; err: string }> {
  let sent: unknown;
  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      sent = JSON.parse(data);
      res.writeHead(reply.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    return await new Promise((resolve) =>
      execFile(
        process.execPath,
        [path.join(process.cwd(), "bin/aos"), ...args],
        {
          env: {
            ...process.env,
            AGENTOS_URL: `http://127.0.0.1:${port}`,
            AGENTOS_SESSION_ID: "me",
          },
        },
        (err, out, errOut) =>
          resolve({
            sent,
            code: err ? Number(err.code ?? 1) : 0,
            out: String(out),
            err: String(errOut),
          })
      )
    );
  } finally {
    server.close();
  }
}

beforeEach(() => moveTask.mockReset());

describe("aos move", () => {
  it("sends the session and machine, and prints where it runs now", async () => {
    const r = await aos(["move", "fix-it", "devbox"], {
      status: 200,
      body: { summary: "Fix it is now running on devbox" },
    });
    expect(r.sent).toEqual({
      from: "me",
      session: "fix-it",
      machine: "devbox",
    });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/now running on devbox/);
  });

  it("exits non-zero with the reason when the move fails", async () => {
    const r = await aos(["move", "fix-it", "devbox"], {
      status: 409,
      body: { error: "box: disk full" },
    });
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/box: disk full/);
  });

  it("needs a machine", async () => {
    const r = await aos(["move", "fix-it"], { status: 200, body: {} });
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/usage: aos move/);
    expect(r.sent).toBeUndefined();
  });
});

describe("the move route behind it", () => {
  it("moves it to the named machine, or back with 'here'", async () => {
    moveTask.mockResolvedValueOnce({ id: "m1", host_id: "h1" });
    const res = await call({
      from: "me",
      session: "fix-it",
      machine: "devbox",
    });
    expect(res.status).toBe(200);
    expect(moveTask).toHaveBeenCalledWith("t1", "h1");
    expect((await res.json()).summary).toBe("Fix it is now running on devbox");

    moveTask.mockResolvedValueOnce({ id: "t9", host_id: "local" });
    const back = await call({ from: "me", session: "fix-it", machine: "here" });
    expect(moveTask).toHaveBeenLastCalledWith("t1", "local");
    expect((await back.json()).summary).toMatch(/on this machine$/);
  });

  it("runs for a script outside any session, unscoped like the UI's move", async () => {
    moveTask.mockResolvedValueOnce({ id: "m2", host_id: "h1" });
    const res = await call({ session: "elsewhere", machine: "devbox" });
    expect(res.status).toBe(200);
    expect(moveTask).toHaveBeenCalledWith("t2", "h1");
  });

  it("refuses a caller that names a session that doesn't exist", async () => {
    const res = await call({
      from: "ghost",
      session: "fix-it",
      machine: "devbox",
    });
    expect(res.status).toBe(409);
    expect(moveTask).not.toHaveBeenCalled();
  });

  it("reaches only the caller's own project", async () => {
    const res = await call({
      from: "me",
      session: "elsewhere",
      machine: "devbox",
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/aos move reaches only those/);
    expect(moveTask).not.toHaveBeenCalled();
  });

  it("names an unknown machine without starting anything", async () => {
    const res = await call({
      from: "me",
      session: "fix-it",
      machine: "nowhere",
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/No machine named "nowhere"/);
    expect(moveTask).not.toHaveBeenCalled();
  });

  it("passes a failed move's reason through", async () => {
    moveTask.mockRejectedValueOnce(new Error("disk full"));
    const res = await call({
      from: "me",
      session: "fix-it",
      machine: "devbox",
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("disk full");
  });
});
