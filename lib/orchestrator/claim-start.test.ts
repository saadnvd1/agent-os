import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/db";
import { tempDir } from "@/lib/test-temp";
import { seedSession, seedWorkspace } from "./testing";

process.env.AGENTOS_LOAD = "off";

const started: string[] = [];
vi.mock("@/lib/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks")>()),
  createTask: async (o: { projectId: string; prompt: string }) => {
    started.push(o.prompt);
    const id = seedSession({
      projectId: o.projectId,
      name: o.prompt,
      task: true,
    });
    return {
      id,
      name: o.prompt,
      branch_name: "feature/x",
      base_branch: "main",
    } as Session;
  },
}));
vi.mock("./usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./usage")>()),
  readUsage: () => ({ window: null }),
}));

const { db } = await import("@/lib/db");
const { ensureOrchestrator } = await import("./home");
const { runTool } = await import("./serve");
const { machineId } = await import("@/lib/claims/machine");
const { liveClaims, upsertLocal, upsertRemote } =
  await import("@/lib/claims/store");
const { tickQueue } = await import("@/lib/tasks/queue");

const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe" });

const FILES = [
  "lib/auth/session.ts",
  "lib/auth/index.ts",
  "lib/auth/token.ts",
  "lib/ui/button.ts",
  "lib/ui/card.ts",
];
const REPO = "git.example.test/team/widgets";

let dir: string;
let ws: string;
let projectName: string;
let projectId: string;

beforeAll(() => {
  vi.spyOn(os, "homedir").mockReturnValue(tempDir("aos-claim-start-"));
  dir = tempDir("claim-repo-");
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
  started.length = 0;
  db.prepare(`DELETE FROM work_claims`).run();
  db.prepare(`UPDATE task_queue SET status = 'removed'`).run();
  const t = seedWorkspace();
  ws = t.workspace.id;
  ensureOrchestrator(ws);
  db.prepare(`UPDATE projects SET working_directory = ? WHERE id = ?`).run(
    dir,
    t.app.id
  );
  projectName = t.app.name;
  projectId = t.app.id;
});

const remote = (files: string[], goal = "Rework login sessions") =>
  upsertRemote(machineId(), "peer-1", {
    id: "claim-box-1",
    origin: "box-machine",
    origin_name: "box",
    hops: 0,
    source: "session",
    session_name: goal,
    repo: REPO,
    branch: "feature/login",
    base: "main",
    goal,
    files,
    files_more: 0,
    pr_url: null,
    ttl_s: 600,
    age_s: 60,
    released: null,
  });

const start = (extra: Record<string, unknown> = {}) =>
  runTool(ws, "start_task", {
    project: projectName,
    prompt: "Touch lib/auth/session.ts lib/auth/index.ts lib/auth/token.ts",
    name: "Tidy auth",
    plan: false,
    plan_reason: "a clear edit",
    ...extra,
  });

const eventLines = () =>
  (
    db
      .prepare(`SELECT line FROM orchestrator_events WHERE workspace_id = ?`)
      .all(ws) as { line: string }[]
  ).map((e) => e.line);

describe("start_task and work claimed elsewhere", () => {
  it("queues a strong overlap after the claim and tells the orchestrator once", async () => {
    remote(FILES.slice(0, 3));
    const text = await start();
    expect(text).toMatch(/^Queued .*after Rework login sessions on box/);
    expect(text).toMatch(/Heads-up, work already claimed/);
    expect(started).toEqual([]);
    const queued = db
      .prepare(`SELECT after_claim FROM task_queue WHERE status = 'queued'`)
      .get() as { after_claim: string };
    expect(queued.after_claim).toBe("claim-box-1");
    expect(eventLines().join("\n")).toMatch(
      /Queued "Tidy auth".*after .*Rework login sessions.*on box.*shared: .*lib\/auth/
    );
  });

  it("starts by itself once the claim is gone", async () => {
    remote(FILES.slice(0, 3));
    await start();
    db.prepare(`UPDATE work_claims SET released = 'merged'`).run();
    await tickQueue();
    expect(started).toEqual([
      "Touch lib/auth/session.ts lib/auth/index.ts lib/auth/token.ts",
    ]);
  });

  it("does not queue a weak overlap, and says so in a heads-up", async () => {
    remote([
      FILES[0],
      FILES[1],
      "lib/other/a.ts",
      "lib/other/b.ts",
      "lib/other/c.ts",
    ]);
    const text = await start({
      prompt: `Touch ${FILES.join(" ")}`,
    });
    expect(text).toMatch(/^Started task/);
    expect(text).toMatch(/Heads-up[\s\S]*weak/);
    expect(started).toHaveLength(1);
  });

  it("skips the queue with now or ignore_claims", async () => {
    remote(FILES.slice(0, 3));
    expect(await start({ now: true, now_reason: "urgent fix" })).toMatch(
      /^Started task/
    );
    expect(await start({ ignore_claims: true, name: "Second" })).toMatch(
      /^Started task/
    );
    expect(started).toHaveLength(2);
  });

  it("an explicit after wins over a claim", async () => {
    remote(FILES.slice(0, 3));
    const other = seedSession({
      projectId,
      name: "earlier-task",
      task: true,
    });
    const text = await start({ after: other });
    expect(text).toMatch(/^Queued .*after earlier-task/);
    expect(
      (
        db
          .prepare(`SELECT after_claim FROM task_queue WHERE status = 'queued'`)
          .get() as { after_claim: string | null }
      ).after_claim
    ).toBeNull();
  });

  it("queues behind a local non-task session through its claim", async () => {
    const sid = seedSession({ projectId, name: "scratch" });
    upsertLocal(
      { id: machineId(), name: "here" },
      {
        sessionId: sid,
        sessionName: "scratch",
        repo: REPO,
        branch: "feature/scratch",
        base: "main",
        goal: "Rework login sessions",
        files: FILES.slice(0, 3),
        filesMore: 0,
        prUrl: null,
      }
    );
    const text = await start();
    expect(text).toMatch(/^Queued .*after Rework login sessions on here/);
    expect(liveClaims()).toHaveLength(1);
  });

  it("starts as usual when the claims code throws", async () => {
    const mod = await import("@/lib/claims/store");
    const spy = vi.spyOn(mod, "liveClaims").mockImplementation(() => {
      throw new Error("db gone");
    });
    try {
      expect(await start()).toMatch(/^Started task/);
    } finally {
      spy.mockRestore();
    }
  });
});
