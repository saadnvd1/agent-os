import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "@/lib/test-temp";
import { seedWorkspace } from "@/lib/orchestrator/testing";

const { db } = await import("@/lib/db");
const { machineId } = await import("@/lib/claims/machine");
const { upsertRemote } = await import("@/lib/claims/store");
const { putSetting } = await import("@/lib/settings-store");
const { POST } = await import("./check/route");

const FILES = ["lib/auth/session.ts", "lib/auth/index.ts", "lib/auth/token.ts"];
const REPO = "git.example.test/team/widgets";

let dir: string;
let projectId: string;

const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe" });

const check = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/claims/check", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );

beforeAll(() => {
  vi.spyOn(os, "homedir").mockReturnValue(tempDir("aos-claim-check-"));
  dir = tempDir("claim-check-repo-");
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
  putSetting("claims.share", "on");
  const t = seedWorkspace();
  projectId = t.app.id;
  db.prepare(`UPDATE projects SET working_directory = ? WHERE id = ?`).run(
    dir,
    projectId
  );
});

const remote = (files: string[]) =>
  upsertRemote(machineId(), "peer-1", {
    id: "claim-box-1",
    origin: "box-machine",
    origin_name: "box",
    hops: 0,
    source: "session",
    session_name: "Rework login sessions",
    repo: REPO,
    branch: "feature/login",
    base: "main",
    goal: "Rework login sessions",
    files,
    files_more: 0,
    pr_url: null,
    ttl_s: 600,
    age_s: 60,
    released: null,
  });

describe("POST /api/claims/check", () => {
  it("refuses a body that isn't a check", async () => {
    expect((await check("nope")).status).toBe(400);
    expect((await check({ projectId })).status).toBe(400);
    expect((await check({ projectId, prompt: 5 })).status).toBe(400);
  });

  it("says nothing when no one else is on the repo", async () => {
    const res = await check({ projectId, prompt: "Tidy auth" });
    expect(await res.json()).toEqual({ overlaps: [] });
  });

  it("returns the overlap with the other claim, strong first", async () => {
    remote(FILES);
    const res = await check({
      projectId,
      name: "Tidy auth",
      prompt: `Touch ${FILES.join(" ")}`,
    });
    const { overlaps } = await res.json();
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({
      strength: "strong",
      claim: { id: "claim-box-1", machine: "box", branch: "feature/login" },
    });
    expect(overlaps[0].shared).toEqual([...FILES].sort());
  });

  it("returns no overlaps when sharing is off", async () => {
    remote(FILES);
    putSetting("claims.share", "off");
    const res = await check({ projectId, prompt: `Touch ${FILES.join(" ")}` });
    expect(await res.json()).toEqual({ overlaps: [] });
  });
});
