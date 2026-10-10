import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { db } from "../db";
import { createProject } from "../projects";
import { seedSession } from "../orchestrator/testing";
import type { PgRun } from "./database";

// A Postgres in memory, behind the same commands the module runs.
class FakePg {
  up = true;
  dbs = new Map<string, string>([
    ["postgres", ""],
    ["app_dev", "shared"],
  ]);
  calls: string[][] = [];
  failRestore = false;
  holdConnection = new Set<string>();
  rejectForce = false;
  envs: NodeJS.ProcessEnv[] = [];

  run: PgRun = async (cmd, args, env) => {
    this.calls.push([cmd, ...args]);
    this.envs.push(env);
    if (!this.up)
      return { code: 2, out: "connection to server on socket failed" };
    if (cmd === "psql" && args.includes("-c"))
      return {
        code: 0,
        out: [...this.dbs].map(([n, c]) => `${n}\t${c}`).join("\n"),
      };
    if (cmd === "createdb") {
      const [, , name, comment] = args;
      if (this.dbs.has(name)) return { code: 1, out: "already exists" };
      this.dbs.set(name, comment ?? "");
      return { code: 0, out: "" };
    }
    if (cmd === "pg_dump") {
      const file = args[args.indexOf("-f") + 1];
      fs.writeFileSync(file, `-- dump of ${args[args.length - 1]}\n`);
      return { code: 0, out: "" };
    }
    if (cmd === "psql") {
      const target = args[args.indexOf("-d") + 1];
      const sql = fs.readFileSync(args[args.indexOf("-f") + 1], "utf-8");
      if (this.failRestore) return { code: 3, out: "ERROR: boom" };
      const mark = /COMMENT ON DATABASE "(.+)" IS '(.+)';/.exec(sql);
      if (mark && mark[1] === target) this.dbs.set(target, mark[2]);
      return { code: 0, out: "" };
    }
    if (cmd === "dropdb") {
      const name = args[args.length - 1];
      if (this.rejectForce && args.includes("--force"))
        return { code: 1, out: "dropdb: error: unrecognized option '--force'" };
      if (this.holdConnection.has(name) && !args.includes("--force"))
        return { code: 1, out: "database is being accessed by other users" };
      this.dbs.delete(name);
      return { code: 0, out: "" };
    }
    return { code: 127, out: "not found" };
  };
}

let pg = new FakePg();

// setupWorktree reaches the module through its own import: the fake goes in
// there too, so nothing here ever talks to a real server.
vi.mock("./database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./database")>();
  return {
    ...actual,
    ensureSessionDatabase: (id: string, d: never) =>
      actual.ensureSessionDatabase(id, d, pg.run),
    dropSessionDatabase: (id: string) => actual.dropSessionDatabase(id, pg.run),
  };
});

const {
  databaseName,
  dropSessionDatabase,
  ensureSessionDatabase,
  sessionDatabase,
} = await import("./database");
const { setupWorktree } = await import("../env-setup");
const { sessionProjectEnv, sessionRunningBrief } = await import("./session");

const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-db-"));
fs.writeFileSync(
  path.join(projectDir, "agentos.json"),
  JSON.stringify({
    database: { from: "app_dev", env: "DB_NAME" },
    setup: ['printf %s "$DB_NAME" > db.txt'],
  })
);
const projectId = createProject({
  name: "db-app",
  workingDirectory: projectDir,
}).id;
const session = () => seedSession({ projectId, name: "s", task: true });
const decl = { from: "app_dev", env: "DB_NAME" };

beforeEach(() => {
  pg = new FakePg();
});

describe("ensureSessionDatabase", () => {
  it("copies from through template0 and pg_dump, never createdb -T <from>", async () => {
    const id = session();
    const made = await ensureSessionDatabase(id, decl, pg.run);
    const name = databaseName("app_dev", id);
    expect(made).toMatchObject({ name, from: "app_dev", env: "DB_NAME" });
    expect(pg.dbs.get(name)).toBe(`agentos session ${id}`);
    expect(pg.calls.map((c) => c[0])).toEqual([
      "psql",
      "createdb",
      "pg_dump",
      "psql",
    ]);
    expect(pg.calls[1]).toEqual(
      expect.arrayContaining(["-T", "template0", name])
    );
    expect(pg.calls[1][pg.calls[1].indexOf("-T") + 1]).toBe("template0");
    expect(pg.calls[3]).toEqual(
      expect.arrayContaining(["-1", "ON_ERROR_STOP=1", "-d", name])
    );
    expect(sessionDatabase(id)).toEqual(made);
  });

  it("names the copy deterministically, within 63 bytes", () => {
    const id = "6f1c2a9e-0000-4000-8000-000000000000";
    expect(databaseName("app_dev", id)).toBe(databaseName("app_dev", id));
    expect(databaseName("app_dev", id)).toMatch(/^app_dev_aos_[0-9a-f]{12}$/);
    expect(databaseName("x".repeat(80), id).length).toBe(63);
  });

  it("reuses its own copy on a second start, without copying again", async () => {
    const id = session();
    await ensureSessionDatabase(id, decl, pg.run);
    pg.calls = [];
    const again = await ensureSessionDatabase(id, decl, pg.run);
    expect(again).toMatchObject({
      name: databaseName("app_dev", id),
      reused: true,
    });
    expect(pg.calls.map((c) => c[0])).toEqual(["psql"]);
  });

  it("remakes a copy of its own that was interrupted mid-restore", async () => {
    const id = session();
    const name = databaseName("app_dev", id);
    pg.dbs.set(name, `agentos session ${id} (copying)`);
    const made = await ensureSessionDatabase(id, decl, pg.run);
    expect(made?.name).toBe(name);
    expect(pg.calls.map((c) => c[0])).toEqual([
      "psql",
      "dropdb",
      "createdb",
      "pg_dump",
      "psql",
    ]);
    expect(pg.dbs.get(name)).toBe(`agentos session ${id}`);
  });

  it("leaves a database of that name AgentOS didn't make", async () => {
    const id = session();
    const name = databaseName("app_dev", id);
    pg.dbs.set(name, "someone's");
    const made = await ensureSessionDatabase(id, decl, pg.run);
    expect(made?.name).toBeNull();
    expect(made?.error).toContain("AgentOS didn't make it");
    expect(pg.dbs.get(name)).toBe("someone's");
    expect(pg.calls.map((c) => c[0])).toEqual(["psql"]);
  });

  it("starts without a copy when Postgres isn't answering, and says why", async () => {
    pg.up = false;
    const id = session();
    const made = await ensureSessionDatabase(id, decl, pg.run);
    expect(made).toMatchObject({ name: null });
    expect(made?.error).toContain("Postgres isn't answering");
    expect(sessionProjectEnv(id).DB_NAME).toBeUndefined();
    expect(sessionRunningBrief(id)).toContain("this session has none");
    expect(sessionRunningBrief(id)).toContain("Postgres isn't answering");
  });

  it("refuses a from that doesn't exist", async () => {
    const made = await ensureSessionDatabase(
      session(),
      { from: "nope_dev" },
      pg.run
    );
    expect(made?.error).toContain("nope_dev doesn't exist");
    expect(pg.calls.map((c) => c[0])).toEqual(["psql"]);
  });

  it("drops a copy whose restore failed, so nothing is half-made", async () => {
    pg.failRestore = true;
    const id = session();
    const made = await ensureSessionDatabase(id, decl, pg.run);
    expect(made?.name).toBeNull();
    expect(made?.error).toContain("was dropped again");
    expect(pg.dbs.has(databaseName("app_dev", id))).toBe(false);
  });

  it.each([
    [
      { from: "host=prod.example.com dbname=app" },
      "isn't a local database name",
    ],
    [{ from: "postgres://prod/app" }, "isn't a local database name"],
    [{ from: "-app" }, "isn't a local database name"],
    [{ from: "app_dev", host: "db.example.com" }, "isn't this machine"],
    [{ from: "app_dev", host: "10.0.0.5" }, "isn't this machine"],
    [{ from: "app_dev", host: "/nope,db.example.com" }, "isn't this machine"],
    [
      { from: "app_dev", host: "localhost,db.example.com" },
      "isn't this machine",
    ],
    [{ from: "app_dev", host: "" }, "isn't this machine"],
    [{ from: "app_dev", env: "PATH" }, "reserved"],
  ])("refuses %j without running anything", async (d, why) => {
    const made = await ensureSessionDatabase(session(), d, pg.run);
    expect(made?.error).toContain(why);
    expect(pg.calls).toEqual([]);
  });

  it("talks only to the server the project names", async () => {
    const saved = { ...process.env };
    process.env.PGHOST = "prod.example.com";
    process.env.PGSERVICE = "prod";
    process.env.PGDATABASE = "prod";
    try {
      await ensureSessionDatabase(
        session(),
        { from: "app_dev", port: 5433, host: "localhost" },
        pg.run
      );
    } finally {
      process.env = saved;
    }
    expect(pg.calls.map((c) => c[0])).toEqual([
      "psql",
      "createdb",
      "pg_dump",
      "psql",
    ]);
    for (const env of pg.envs) {
      expect(env.PGHOST).toBe("localhost");
      expect(env.PGPORT).toBe("5433");
      expect(env.PGSERVICE).toBeUndefined();
      expect(env.PGDATABASE).toBeUndefined();
      expect(env.PGCONNECT_TIMEOUT).toBe("10");
    }
  });

  it("records the copy before making it, so a cut-short one is dropped at the end", async () => {
    const id = session();
    const name = databaseName("app_dev", id);
    // The server stops mid-restore: the row says pending, the database exists.
    const run = pg.run;
    pg.run = async (cmd, args, env) => {
      if (cmd === "psql" && args.includes("-f")) {
        expect(sessionDatabase(id)).toMatchObject({ name, pending: true });
        throw new Error("AgentOS restarted");
      }
      return run(cmd, args, env);
    };
    await ensureSessionDatabase(id, decl, pg.run);
    db.prepare(`UPDATE sessions SET database = ? WHERE id = ?`).run(
      JSON.stringify({ name, from: "app_dev", env: "DB_NAME", pending: true }),
      id
    );
    expect(sessionProjectEnv(id).DB_NAME).toBeUndefined();
    expect(sessionRunningBrief(id)).toContain("cut short");
    pg.run = run;
    await dropSessionDatabase(id, pg.run);
    expect(pg.dbs.has(name)).toBe(false);
  });

  it("drops the copy it made when the session was deleted meanwhile", async () => {
    const id = session();
    const run = pg.run;
    pg.run = async (cmd, args, env) => {
      if (cmd === "pg_dump")
        db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
      return run(cmd, args, env);
    };
    expect(await ensureSessionDatabase(id, decl, pg.run)).toBeNull();
    expect(pg.dbs.has(databaseName("app_dev", id))).toBe(false);
  });

  it("never inherits a PGHOST when the project names none", async () => {
    const saved = { ...process.env };
    process.env.PGHOST = "prod.example.com";
    try {
      await ensureSessionDatabase(session(), decl, pg.run);
    } finally {
      process.env = saved;
    }
    expect(pg.envs.length).toBe(4);
    for (const env of pg.envs) expect(env.PGHOST).toBeUndefined();
  });

  it("is skipped for a session on another machine", async () => {
    const id = session();
    db.prepare(`UPDATE sessions SET host_id = 'box' WHERE id = ?`).run(id);
    expect(await ensureSessionDatabase(id, decl, pg.run)).toBeNull();
    expect(pg.calls).toEqual([]);
  });
});

describe("the session's env and brief", () => {
  it("exports the copy and its server to the agent, and says writes are safe", async () => {
    const id = session();
    await ensureSessionDatabase(
      id,
      { from: "app_dev", env: "DB_NAME", port: 5433 },
      pg.run
    );
    const name = databaseName("app_dev", id);
    expect(sessionProjectEnv(id)).toMatchObject({
      DB_NAME: name,
      DATABASE_PORT: "5433",
      PGPORT: "5433",
    });
    const brief = sessionRunningBrief(id);
    expect(brief).toContain(`Your own database: \`${name}\``);
    expect(brief).toContain("Writes and migrations are safe there");
  });
});

describe("setupWorktree with a database", () => {
  it("makes the copy before setup runs, with its name in setup's env", async () => {
    const id = session();
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "aos-db-wt-"));
    const result = await setupWorktree({
      worktreePath: worktree,
      sourcePath: projectDir,
      sessionId: id,
      skipInstall: true,
    });
    expect(result.success).toBe(true);
    const name = databaseName("app_dev", id);
    expect(result.steps[0]).toMatchObject({
      name: "Private database",
      success: true,
      output: `Copied into ${name}`,
    });
    expect(fs.readFileSync(path.join(worktree, "db.txt"), "utf-8")).toBe(name);
  });

  it("still succeeds without a copy; the step and the env say there's none", async () => {
    pg.up = false;
    const id = session();
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "aos-db-wt-"));
    const result = await setupWorktree({
      worktreePath: worktree,
      sourcePath: projectDir,
      sessionId: id,
      skipInstall: true,
    });
    expect(result.success).toBe(true);
    expect(result.steps[0]).toMatchObject({
      name: "Private database",
      success: false,
    });
    expect(fs.readFileSync(path.join(worktree, "db.txt"), "utf-8")).toBe("");
  });
});

describe("dropSessionDatabase", () => {
  it("drops the session's copy and forgets it, never from", async () => {
    const id = session();
    await ensureSessionDatabase(id, decl, pg.run);
    await dropSessionDatabase(id, pg.run);
    expect(pg.dbs.has(databaseName("app_dev", id))).toBe(false);
    expect(pg.dbs.has("app_dev")).toBe(true);
    expect(sessionDatabase(id)).toBeNull();
    const dropped = pg.calls.filter((c) => c[0] === "dropdb").flat();
    expect(dropped).not.toContain("app_dev");
  });

  it("ends a straggler's connection with --force", async () => {
    const id = session();
    await ensureSessionDatabase(id, decl, pg.run);
    pg.holdConnection.add(databaseName("app_dev", id));
    await dropSessionDatabase(id, pg.run);
    expect(pg.dbs.has(databaseName("app_dev", id))).toBe(false);
  });

  it("drops with a plain dropdb on a Postgres before 13", async () => {
    const id = session();
    const name = databaseName("app_dev", id);
    await ensureSessionDatabase(id, decl, pg.run);
    pg.rejectForce = true;
    pg.calls = [];
    await dropSessionDatabase(id, pg.run);
    expect(pg.calls.filter((c) => c[0] === "dropdb")).toEqual([
      ["dropdb", "--if-exists", "--force", name],
      ["dropdb", "--if-exists", name],
    ]);
    expect(pg.dbs.has(name)).toBe(false);
    expect(sessionDatabase(id)).toBeNull();
  });

  it("never drops a database AgentOS didn't make, even under the recorded name", async () => {
    const id = session();
    const name = databaseName("app_dev", id);
    db.prepare(`UPDATE sessions SET database = ? WHERE id = ?`).run(
      JSON.stringify({ name, from: "app_dev", env: "DB_NAME" }),
      id
    );
    pg.dbs.set(name, "someone's");
    await dropSessionDatabase(id, pg.run);
    expect(pg.dbs.get(name)).toBe("someone's");
    expect(pg.calls.some((c) => c[0] === "dropdb")).toBe(false);
  });

  it("never drops the from database, whatever the row says", async () => {
    const id = session();
    db.prepare(`UPDATE sessions SET database = ? WHERE id = ?`).run(
      JSON.stringify({ name: "app_dev", from: "app_dev", env: "DB_NAME" }),
      id
    );
    await dropSessionDatabase(id, pg.run);
    expect(pg.calls).toEqual([]);
    expect(pg.dbs.has("app_dev")).toBe(true);
  });

  it("reads the row before the caller deletes it", async () => {
    const id = session();
    await ensureSessionDatabase(id, decl, pg.run);
    const dropping = dropSessionDatabase(id, pg.run);
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
    await dropping;
    expect(pg.dbs.has(databaseName("app_dev", id))).toBe(false);
  });

  it("leaves the copy and the record when Postgres is down", async () => {
    const id = session();
    await ensureSessionDatabase(id, decl, pg.run);
    pg.up = false;
    await dropSessionDatabase(id, pg.run);
    expect(sessionDatabase(id)?.name).toBe(databaseName("app_dev", id));
  });
});
