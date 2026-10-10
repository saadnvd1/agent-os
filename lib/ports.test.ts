import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { db } from "./db";
import { createProject } from "./projects";
import { seedSession } from "./orchestrator/testing";
import { allocatePorts, releasePorts, sessionPorts } from "./ports";
import { agentEnv } from "./agents/launch";
import { sessionRunningBrief } from "./project-config/session";

const free = async () => false;
const bases = { RAILS_PORT: 3000, VITE_PORT: 3100 };

const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-ports-"));
const projectId = createProject({
  name: "ports-app",
  workingDirectory: projectDir,
}).id;
const session = (task = true) => seedSession({ projectId, name: "s", task });

beforeEach(() => {
  db.prepare(
    `UPDATE sessions SET port_slot = NULL, ports = NULL, dev_server_port = NULL`
  ).run();
});

describe("allocatePorts", () => {
  it("gives every named port the slot's offset, stored on the row", async () => {
    const id = session();
    const got = await allocatePorts(id, bases, free);
    expect(got).toEqual({
      slot: 1,
      ports: { RAILS_PORT: 3001, VITE_PORT: 3101 },
    });
    expect(sessionPorts(id)).toEqual(got.ports);
    const row = db
      .prepare(`SELECT dev_server_port FROM sessions WHERE id = ?`)
      .get(id) as { dev_server_port: number };
    expect(row.dev_server_port).toBe(3001);
  });

  it("keeps a session's ports across a second call (a resume)", async () => {
    const id = session();
    const first = await allocatePorts(id, bases, free);
    await allocatePorts(session(), bases, free);
    expect(await allocatePorts(id, bases, free)).toEqual(first);
  });

  it("never gives two parallel sessions one slot or one port", async () => {
    const ids = Array.from({ length: 12 }, () => session());
    const got = await Promise.all(
      ids.map((id) => allocatePorts(id, bases, free))
    );
    const slots = got.map((g) => g.slot);
    expect(new Set(slots).size).toBe(ids.length);
    const ports = got.flatMap((g) => Object.values(g.ports));
    expect(new Set(ports).size).toBe(ports.length);
  });

  it("skips a slot whose port another project's session holds", async () => {
    // Another project's base lands on slot 1's RAILS_PORT.
    await allocatePorts(session(), { WEB: 3000 }, free); // 3001
    const got = await allocatePorts(session(), bases, free);
    expect(got.slot).toBe(2);
  });

  it("skips a slot whose port something outside AgentOS listens on", async () => {
    const got = await allocatePorts(session(), bases, async (p) => p === 3101);
    expect(got.ports).toEqual({ RAILS_PORT: 3002, VITE_PORT: 3102 });
  });

  it("frees the slot when the session ends", async () => {
    const a = session();
    const first = await allocatePorts(a, bases, free);
    releasePorts(a);
    expect(sessionPorts(a)).toBeNull();
    expect((await allocatePorts(session(), bases, free)).slot).toBe(first.slot);
  });

  it("takes back the slot of a session that ended without releasing it", async () => {
    const done = session();
    const archived = session();
    await allocatePorts(done, bases, free);
    await allocatePorts(archived, bases, free);
    db.prepare(`UPDATE sessions SET task_status = 'merged' WHERE id = ?`).run(
      done
    );
    db.prepare(
      `UPDATE sessions SET archived_at = datetime('now') WHERE id = ?`
    ).run(archived);
    expect((await allocatePorts(session(), bases, free)).slot).toBe(1);
    expect(sessionPorts(done)).toBeNull();
  });
});

describe("agentEnv", () => {
  it("carries the project's env, the session's ports over it, and AgentOS's own", async () => {
    fs.writeFileSync(
      path.join(projectDir, "agentos.json"),
      JSON.stringify({
        ports: bases,
        env: { RAILS_PORT: "1", STORAGE: "disk", AGENTOS_SESSION_ID: "spoof" },
      })
    );
    const id = session();
    await allocatePorts(id, bases, free);
    const env = agentEnv(id);
    expect(env).toMatchObject({
      RAILS_PORT: "3001",
      VITE_PORT: "3101",
      STORAGE: "disk",
      AGENTOS_SESSION_ID: id,
    });
    expect(env.AGENTOS_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("has only AgentOS's own for a session without a project config or ports", () => {
    fs.rmSync(path.join(projectDir, "agentos.json"), { force: true });
    const id = session(false);
    expect(Object.keys(agentEnv(id)).sort()).toEqual([
      "AGENTOS_SESSION_ID",
      "AGENTOS_URL",
      "PATH",
    ]);
  });

  it("still opens with a broken config", async () => {
    fs.writeFileSync(path.join(projectDir, "agentos.json"), "{ nope");
    const id = session();
    await allocatePorts(id, { PORT: 3100 }, free);
    expect(agentEnv(id)).toMatchObject({
      PORT: "3101",
      AGENTOS_SESSION_ID: id,
    });
    fs.rmSync(path.join(projectDir, "agentos.json"), { force: true });
  });
});

describe("sessionRunningBrief", () => {
  it("is the project's running section on the session's own ports", async () => {
    fs.writeFileSync(
      path.join(projectDir, "agentos.json"),
      JSON.stringify({
        ports: bases,
        dev: "bin/dev",
        browse: { login: "/login" },
      })
    );
    const id = session();
    await allocatePorts(id, bases, free);
    const brief = sessionRunningBrief(id);
    expect(brief).toContain("RAILS_PORT=3001, VITE_PORT=3101");
    expect(brief).toContain("http://localhost:3001/login");
    fs.rmSync(path.join(projectDir, "agentos.json"), { force: true });
    expect(sessionRunningBrief(id)).toBe("");
  });
});
