import http from "http";
import path from "path";
import { execFile } from "child_process";
import type { AddressInfo } from "net";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const moveTask = vi.fn();
vi.mock("@/lib/tasks", () => ({ moveTask }));
const sessions: Record<
  string,
  { id: string; name: string; project_id: string }
> = {
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
  getDoneTarget: (id: string) => sessions[id],
}));
vi.mock("@/lib/done/bulk", () => ({
  scopeOf: () => ({ projectId: "p1" }),
  inScope: (_: unknown, s: { project_id: string }) => s.project_id === "p1",
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

beforeEach(() => moveTask.mockReset());

describe("aos move", () => {
  it("sends the session and machine, and prints where it runs now", async () => {
    let body: unknown;
    const server = http.createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        body = JSON.parse(data);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ summary: "Fix it is now running on devbox" }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    try {
      const out = await new Promise<string>((resolve, reject) =>
        execFile(
          process.execPath,
          [path.join(process.cwd(), "bin/aos"), "move", "fix-it", "devbox"],
          {
            env: {
              ...process.env,
              AGENTOS_URL: `http://127.0.0.1:${port}`,
              AGENTOS_SESSION_ID: "me",
            },
          },
          (err, stdout) => (err ? reject(err) : resolve(stdout))
        )
      );
      expect(body).toEqual({
        from: "me",
        session: "fix-it",
        machine: "devbox",
      });
      expect(out).toMatch(/now running on devbox/);
    } finally {
      server.close();
    }
  });

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
    const back = await call({ session: "fix-it", machine: "here" });
    expect(moveTask).toHaveBeenLastCalledWith("t1", "local");
    expect((await back.json()).summary).toMatch(/on this machine$/);
  });

  it("from inside a session, reaches only that session's project", async () => {
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
    const res = await call({ session: "fix-it", machine: "nowhere" });
    expect((await res.json()).error).toMatch(/No machine named "nowhere"/);
    expect(moveTask).not.toHaveBeenCalled();
  });

  it("passes a failed move's reason through", async () => {
    moveTask.mockRejectedValueOnce(new Error("disk full"));
    const res = await call({ session: "fix-it", machine: "devbox" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("disk full");
  });
});
