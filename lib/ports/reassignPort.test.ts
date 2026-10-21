import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createProject } from "@/lib/projects";
import { seedSession } from "@/lib/orchestrator/testing";
import { tempDir } from "@/lib/test-temp";
import { allocatePorts, sessionPorts } from "./allocatePorts";
import { ensurePorts, type EnsureDeps } from "./ensurePorts";
import { reassignPort } from "./reassignPort";
import type { Listener } from "./types";

const free = async () => false;
const gone = async () => false;
const projectId = createProject({
  name: "reassign-app",
  workingDirectory: tempDir("aos-reassign-"),
}).id;
const session = () => seedSession({ projectId, name: "s", task: true });

beforeEach(() => {
  db.prepare(
    `UPDATE sessions SET port_slot = NULL, ports = NULL, dev_server_port = NULL`
  ).run();
});

describe("reassignPort", () => {
  it("moves the port to the next free one and keeps the slot", async () => {
    const id = session();
    await allocatePorts(id, { PORT: 3100, VITE: 5100 }, free, gone);
    const other = session();
    await allocatePorts(other, { PORT: 3100, VITE: 5100 }, free, gone);
    const busy = new Set([3103]);
    const to = await reassignPort(
      id,
      "PORT",
      async (p) => busy.has(p),
      new Set([3104])
    );
    // 3102 is the other session's, 3103 listens, 3104 is AgentOS's own.
    expect(to).toBe(3105);
    expect(sessionPorts(id)).toEqual({ PORT: 3105, VITE: 5101 });
    const row = db
      .prepare(`SELECT port_slot, dev_server_port FROM sessions WHERE id = ?`)
      .get(id);
    expect(row).toEqual({ port_slot: 1, dev_server_port: 3105 });
  });

  it("never gives two parallel moves one port", async () => {
    const a = session();
    const b = session();
    await allocatePorts(a, { PORT: 3100 }, free, gone);
    await allocatePorts(b, { PORT: 3200 }, free, gone);
    db.prepare(`UPDATE sessions SET ports = ? WHERE id = ?`).run(
      JSON.stringify({ PORT: 3500 }),
      b
    );
    db.prepare(`UPDATE sessions SET ports = ? WHERE id = ?`).run(
      JSON.stringify({ PORT: 3499 }),
      a
    );
    const [x, y] = await Promise.all([
      reassignPort(a, "PORT", free, new Set()),
      reassignPort(b, "PORT", free, new Set()),
    ]);
    expect(x).not.toBe(y);
  });

  it("refuses a name the session doesn't have", async () => {
    const id = session();
    await allocatePorts(id, { PORT: 3100 }, free, gone);
    await expect(reassignPort(id, "NOPE", free, new Set())).rejects.toThrow(
      /no port named NOPE/
    );
  });
});

const deps = (listeners: Listener[] | null): EnsureDeps => ({
  listeners: async () => listeners,
  reassign: (id, name) => reassignPort(id, name, free, new Set()),
  allocate: (id, bases) => allocatePorts(id, bases, free, gone),
});
const outsider = (port: number): Listener => ({
  port,
  pid: 4121,
  command: "node",
  cwd: "/home/u/elsewhere",
});

describe("ensurePorts", () => {
  it("says the session's ports are free and changes nothing", async () => {
    const id = session();
    await allocatePorts(id, { PORT: 3100 }, free, gone);
    const r = await ensurePorts(id, undefined, deps([]));
    expect(r).toMatchObject({
      blocked: false,
      moved: [],
      ports: { PORT: 3101 },
    });
    expect(r.text).toBe("PORT=3101 is free.");
  });

  it("moves a port someone else holds and names who", async () => {
    const id = session();
    await allocatePorts(id, { PORT: 3100 }, free, gone);
    const r = await ensurePorts(id, "PORT", deps([outsider(3101)]));
    expect(r.blocked).toBe(true);
    expect(r.moved).toEqual([{ name: "PORT", from: 3101, to: 3102 }]);
    expect(r.text).toContain(
      "PORT=3101 is held by pid 4121 (node) in /home/u/elsewhere, outside AgentOS on this machine. Don't wait for it and don't stop it."
    );
    expect(r.text).toContain("Your PORT is now 3102");
    expect(r.text).toContain("aos send orchestrator");
  });

  it("answers about a hardcoded port with the session's own", async () => {
    const id = session();
    await allocatePorts(id, { PORT: 3100 }, free, gone);
    const r = await ensurePorts(id, "3000", deps([outsider(3000)]));
    expect(r.checks.map((c) => [c.port, c.free])).toEqual([
      [3000, false],
      [3101, true],
    ]);
    expect(r.blocked).toBe(true);
    expect(r.moved).toEqual([]);
  });

  it("gives a session with no ports a slot first", async () => {
    const id = session();
    const r = await ensurePorts(id, undefined, deps([]));
    expect(r.ports).toEqual({ PORT: 3101 });
  });

  it("refuses a name that isn't the session's", async () => {
    const id = session();
    await allocatePorts(id, { PORT: 3100 }, free, gone);
    await expect(ensurePorts(id, "VITE", deps([]))).rejects.toThrow(
      /No port named VITE: yours are PORT=3101/
    );
  });
});
