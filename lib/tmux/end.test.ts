import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tempDir } from "@/lib/test-temp";

// Real tmux, on a private socket in a temp dir: never the user's server.
const hasTmux = (() => {
  try {
    execFileSync("tmux", ["-V"]);
    return true;
  } catch {
    return false;
  }
})();

const dir = tempDir("aos-tmux-");
const saved = { ...process.env };
delete process.env.TMUX;
delete process.env.TMUX_PANE;
delete process.env.AGENTOS_SESSION_ID;
process.env.TMUX_TMPDIR = dir;

const { endTmuxSession } = await import("./end");
const { sweepOrphanTmux } = await import("./orphans");

const tmux = (...args: string[]) =>
  execFileSync("tmux", args, { encoding: "utf8", env: process.env });
const has = (name: string) => {
  try {
    tmux("has-session", "-t", `=${name}`);
    return true;
  } catch {
    return false;
  }
};
// A killed process nothing reaps stays a zombie; that is dead for our purpose.
const alive = (pid: number) => {
  for (let i = 0; i < 20; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return false;
    }
    let stat = "";
    try {
      stat = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], {
        encoding: "utf8",
      }).trim();
    } catch {
      return false;
    }
    if (!stat || stat.startsWith("Z")) return false;
    execFileSync("sleep", ["0.1"]);
  }
  return true;
};
const start = (name: string, cmd: string, ...extra: string[]) =>
  tmux("new-session", "-d", "-s", name, ...extra, cmd);

// A pane whose shell leaves a background sleeper behind, pid in a file.
function startWithChild(name: string, ...extra: string[]): number {
  const pidFile = path.join(dir, `${name}.pid`);
  start(name, `sleep 300 & echo $! > ${pidFile}; wait`, ...extra);
  for (let i = 0; i < 50 && !fs.existsSync(pidFile); i++)
    execFileSync("sleep", ["0.1"]);
  const pid = Number(fs.readFileSync(pidFile, "utf8"));
  process.kill(pid, 0);
  return pid;
}

describe.skipIf(!hasTmux)("ending tmux sessions", () => {
  beforeAll(() => {
    start("anchor", "sleep 300");
    // The tests below kill things: be sure it is the private server.
    expect(tmux("display-message", "-p", "#{socket_path}")).toContain(dir);
  });
  afterAll(() => {
    try {
      tmux("kill-server");
    } catch {
      // Already gone.
    }
    fs.rmSync(dir, { recursive: true, force: true });
    process.env = saved;
  });

  it("ends the session and what its panes started, leaving others", async () => {
    const mine = `claude-${randomUUID()}`;
    const child = startWithChild(mine);
    await endTmuxSession(null, mine);
    expect(has(mine)).toBe(false);
    expect(alive(child)).toBe(false);
    expect(has("anchor")).toBe(true);
  });

  it("does nothing for a session that isn't there or a bad name", async () => {
    await endTmuxSession(null, "nope");
    await endTmuxSession(null, "a b; kill-server");
    await endTmuxSession(null, null);
    expect(has("anchor")).toBe(true);
  });

  it("matches the name exactly, not as a prefix", async () => {
    start("work", "sleep 300");
    start("work-long", "sleep 300");
    await endTmuxSession(null, "work");
    expect(has("work")).toBe(false);
    expect(has("work-long")).toBe(true);
    await endTmuxSession(null, "work-long");
  });

  it("sweeps AgentOS's own sessions with no row and nothing else", async () => {
    const orphan = `claude-${randomUUID()}`;
    const withRow = `claude-${randomUUID()}`;
    const worker = `aos-chat-${randomUUID()}`;
    const taggedId = randomUUID();
    const renamed = "renamed-by-user";
    const external = "dispatch-roa-1";
    const orphanChild = startWithChild(orphan);
    start(withRow, "sleep 300");
    start(worker, "sleep 300");
    start(renamed, "sleep 300", "-e", `AGENTOS_SESSION_ID=${taggedId}`);
    start(external, "sleep 300");
    const rows = [
      { id: withRow.slice(-36), tmux_name: withRow, host_id: null },
    ];

    const dry = await sweepOrphanTmux({
      rows,
      dryRun: true,
      createdBefore: Infinity,
    });
    expect(dry.found.sort()).toEqual([orphan, renamed, worker].sort());
    expect(has(orphan)).toBe(true);

    const out = await sweepOrphanTmux({ rows, createdBefore: Infinity });
    expect(out.killed.sort()).toEqual([orphan, renamed, worker].sort());
    expect(has(orphan) || has(worker) || has(renamed)).toBe(false);
    expect(alive(orphanChild)).toBe(false);
    expect(has(withRow)).toBe(true);
    expect(has(external)).toBe(true);
    expect(has("anchor")).toBe(true);
    await endTmuxSession(null, withRow);
    await endTmuxSession(null, external);
  });

  it("leaves a session created after the cutoff alone", async () => {
    const fresh = `claude-${randomUUID()}`;
    start(fresh, "sleep 300");
    const rows = [{ id: randomUUID(), tmux_name: "x", host_id: null }];
    const out = await sweepOrphanTmux({ rows, createdBefore: 1 });
    expect(out.found).toEqual([]);
    expect(has(fresh)).toBe(true);
    await endTmuxSession(null, fresh);
  });

  it("takes no session as tagged when the whole server carries the tag", async () => {
    const mine = `my-own-terminal`;
    start(mine, "sleep 300");
    tmux("set-environment", "-g", "AGENTOS_SESSION_ID", randomUUID());
    const rows = [{ id: randomUUID(), tmux_name: "x", host_id: null }];
    try {
      const out = await sweepOrphanTmux({ rows, createdBefore: Infinity });
      expect(out.found).toEqual([]);
      expect(has(mine)).toBe(true);
    } finally {
      tmux("set-environment", "-gu", "AGENTOS_SESSION_ID");
      await endTmuxSession(null, mine);
    }
  });

  it("sweeps nothing when there are no rows at all", async () => {
    const orphan = `claude-${randomUUID()}`;
    start(orphan, "sleep 300");
    expect(
      await sweepOrphanTmux({ rows: [], createdBefore: Infinity })
    ).toEqual({
      found: [],
      killed: [],
    });
    expect(has(orphan)).toBe(true);
    await endTmuxSession(null, orphan);
  });
});
