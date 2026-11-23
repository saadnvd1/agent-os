import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, insertSessionRow } from "@/lib/db";
import { tempDir } from "@/lib/test-temp";
import { seedWorkspace } from "@/lib/orchestrator/testing";
import { putSetting } from "@/lib/settings-store";
import { machineId } from "./machine";
import { checkStart } from "./startCheck";
import { liveClaims, upsertLocal } from "./store";
import { endedHow } from "./ended";
import { archiveSession } from "@/lib/done/archive";

const REPO = "git.example.test/team/widgets";
const FILES = ["app/messages.en.json", "app/other.ts", "app/third.ts"];
let dir: string;
let projectId: string;

const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe" });

beforeAll(() => {
  vi.spyOn(os, "homedir").mockReturnValue(tempDir("aos-ended-"));
  dir = tempDir("ended-repo-");
  sh(dir, "init", "-q", "-b", "main");
  sh(dir, "config", "user.email", "t@example.test");
  sh(dir, "config", "user.name", "t");
  sh(dir, "remote", "add", "origin", "git@git.example.test:team/widgets.git");
  for (const f of FILES) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), "x");
  }
  sh(dir, "add", "-A");
  sh(dir, "commit", "-q", "-m", "init");
});

beforeEach(() => {
  db.prepare(`DELETE FROM work_claims`).run();
  db.prepare(`DELETE FROM sessions`).run();
  putSetting("claims.share", "on");
  projectId = seedWorkspace().app.id;
  db.prepare(`UPDATE projects SET working_directory = ? WHERE id = ?`).run(
    dir,
    projectId
  );
});

function claimed(id: string, extra: Record<string, unknown> = {}) {
  insertSessionRow(db, {
    id,
    name: `Task ${id}`,
    tmux_name: `claude-${id}`,
    working_directory: dir,
    ...extra,
  } as Parameters<typeof insertSessionRow>[1]);
  upsertLocal(
    { id: machineId(), name: "here" },
    {
      sessionId: id,
      sessionName: `Task ${id}`,
      repo: REPO,
      branch: `feature/${id}`,
      base: "main",
      goal: `Edit strings ${id}`,
      files: FILES,
      filesMore: 0,
      prUrl: null,
    }
  );
}

const start = () =>
  checkStart({
    projectId,
    prompt: `Change ${FILES.join(" and ")} for the new copy`,
  });

describe("a claim of a session that ended", () => {
  it("a live session's claim still holds a start", async () => {
    claimed("live", { task_status: "running" });
    const { overlaps } = await start();
    expect(overlaps.map((o) => o.strength)).toEqual(["strong"]);
  });

  it.each([
    ["done", { task_status: "done" }],
    ["dropped", { task_status: "dropped" }],
    ["on the Done shelf", { settled_at: "2026-11-20 10:00:00" }],
    ["archived", { archived_at: "2026-11-20 10:00:00" }],
    ["merged", { pr_status: "merged", task_status: "merged" }],
  ])("a session that is %s doesn't hold a start", async (_n, extra) => {
    claimed("old", extra);
    expect(liveClaims()).toHaveLength(1);
    expect((await start()).overlaps).toEqual([]);
  });

  it("a claim whose session is gone doesn't hold a start", async () => {
    claimed("gone");
    db.prepare(`DELETE FROM sessions WHERE id = 'gone'`).run();
    expect((await start()).overlaps).toEqual([]);
  });

  it("archiving a session releases its claim", () => {
    claimed("arch", { task_status: "done" });
    archiveSession("arch");
    expect(liveClaims()).toEqual([]);
  });

  it("names how a session ended", () => {
    expect(endedHow({ pr_status: "merged" })).toBe("merged");
    expect(endedHow({ pr_status: "closed" })).toBe("done");
    expect(endedHow({ task_status: "running", pr_status: "open" })).toBeNull();
  });
});
