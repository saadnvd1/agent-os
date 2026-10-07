import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { codexResumeId, opencodeResumeId, piResumeId } from "./resume-ids";

let home: string;
const saved = { ...process.env };

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "resume-ids-"));
  process.env.CODEX_HOME = path.join(home, "codex");
  process.env.PI_CODING_AGENT_DIR = path.join(home, "pi");
  delete process.env.PI_CODING_AGENT_SESSION_DIR;
});

afterEach(() => {
  // In place: a replaced process.env no longer reaches os.homedir().
  for (const k of Object.keys(process.env))
    if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  fs.rmSync(home, { recursive: true, force: true });
});

const ID = "01a10ef7-7709-7753-a089-a5fd2f8df3ee";
const OTHER = "01a10ef7-0000-7753-a089-a5fd2f8df3ee";

function rollout(cwd: string, id: string, at: Date) {
  const day = path.join(
    home,
    "codex",
    "sessions",
    String(at.getFullYear()),
    String(at.getMonth() + 1).padStart(2, "0"),
    String(at.getDate()).padStart(2, "0")
  );
  fs.mkdirSync(day, { recursive: true });
  const file = path.join(day, `rollout-2026-10-07T05-00-00-${id}.jsonl`);
  const meta = { type: "session_meta", payload: { id, cwd } };
  fs.writeFileSync(file, `${JSON.stringify(meta)}\n`);
  return file;
}

describe("codexResumeId", () => {
  it("finds today's conversation that ran in the folder, not just the newest", () => {
    const now = new Date();
    const mine = rollout("/w", ID, now);
    rollout("/elsewhere", OTHER, now);
    const older = (now.getTime() - 60 * 1000) / 1000;
    fs.utimesSync(mine, older, older);
    expect(codexResumeId("/w", now.getTime())).toBe(ID);
    expect(codexResumeId("/elsewhere", now.getTime())).toBe(OTHER);
  });

  it("ignores a conversation nobody has written to lately", () => {
    const now = new Date();
    const file = rollout("/w", ID, now);
    const old = (now.getTime() - 10 * 60 * 1000) / 1000;
    fs.utimesSync(file, old, old);
    expect(codexResumeId("/w", now.getTime())).toBeNull();
  });
});

describe("piResumeId", () => {
  it("reads the id from the folder's newest session file", () => {
    const dir = path.join(home, "pi", "sessions", "--Users-me-app--");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `2026-10-07T10-51-43-913Z_${ID}.jsonl`),
      ""
    );
    expect(piResumeId("/Users/me/app")).toBe(ID);
    expect(piResumeId("/Users/me/other")).toBeNull();
    expect(piResumeId("/Users/me/app", Date.now() + 10 * 60 * 1000)).toBeNull();
  });
});

describe("opencodeResumeId", () => {
  it("takes the folder's main session written lately, not a subagent's", () => {
    process.env.XDG_DATA_HOME = home;
    fs.mkdirSync(path.join(home, "opencode"));
    const db = new Database(path.join(home, "opencode", "opencode.db"));
    db.exec(
      `CREATE TABLE session (id TEXT, parent_id TEXT, directory TEXT, time_updated INTEGER)`
    );
    const now = Date.now();
    const add = db.prepare(`INSERT INTO session VALUES (?, ?, ?, ?)`);
    add.run("ses_main", null, "/w", now - 60_000);
    add.run("ses_child", "ses_main", "/w", now);
    add.run("ses_old", null, "/w", now - 3_600_000);
    add.run("ses_other", null, "/elsewhere", now);
    db.close();
    expect(opencodeResumeId("/w", now)).toBe("ses_main");
    expect(opencodeResumeId("/nowhere", now)).toBeNull();
    // Last written 11 minutes before: some earlier conversation's.
    expect(opencodeResumeId("/w", now + 10 * 60 * 1000)).toBeNull();
  });
});
