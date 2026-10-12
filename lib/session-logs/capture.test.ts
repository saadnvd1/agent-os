import fs from "fs";
import os from "os";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const modelCalls = vi.hoisted(() => ({
  query: vi.fn(),
  runClaude: vi.fn(),
  chatDriverFor: vi.fn(),
  gh: vi.fn(),
}));

// Anything that could reach a model: the agent SDK, the one-shot claude
// runner, the chat drivers, and the network.
vi.mock("@anthropic-ai/claude-agent-sdk", async (orig) => ({
  ...(await orig<object>()),
  query: modelCalls.query,
}));
vi.mock("../orchestrator/claude-cli", async (orig) => ({
  ...(await orig<object>()),
  runClaude: modelCalls.runClaude,
}));
vi.mock("../chat/drivers", async (orig) => ({
  ...(await orig<object>()),
  chatDriverFor: modelCalls.chatDriverFor,
}));
vi.mock("../tasks/gh", async (orig) => ({
  ...(await orig<object>()),
  run: modelCalls.gh,
}));
vi.mock("./build", async (orig) => {
  const real = await orig<typeof import("./build")>();
  return { ...real, buildLogMarkdown: vi.fn(real.buildLogMarkdown) };
});

import { db } from "../db";
import { saveItem, flushItems } from "../chat/store";
import { amendBrief } from "../orchestrator/amendments";
import { seedWorkspace } from "../orchestrator/testing";
import { buildLogMarkdown } from "./build";
import {
  captureMergedTask,
  writeLog,
  getLog,
  listLogs,
  resetSessionLogState,
  setLogFolder,
} from "./index";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-logs-"));
const MERGED = "2026-10-12 10:15:00";

function mergedTask(over: { status?: string; plan?: string | null } = {}) {
  const w = seedWorkspace();
  const id = w.task;
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "wt-"));
  if (over.plan) {
    fs.mkdirSync(path.join(worktree, ".agentos"));
    fs.writeFileSync(path.join(worktree, ".agentos", "plan.md"), over.plan);
  }
  db.prepare(
    `UPDATE sessions SET task_prompt = 'Add auth', task_status = ?, pr_status = 'merged',
       pr_number = 7, pr_url = 'https://github.com/acme/api/pull/7',
       worktree_path = ?, created_at = '2026-10-12 09:00:00', merged_at = ?
     WHERE id = ?`
  ).run(over.status ?? "merged", worktree, MERGED, id);
  setLogFolder(w.api.id, path.join(dir, id));
  return { ...w, id, worktree };
}

beforeEach(() => {
  resetSessionLogState();
  db.exec(`DELETE FROM session_logs`);
  vi.clearAllMocks();
  modelCalls.gh.mockRejectedValue(new Error("no gh in tests"));
});

describe("captureMergedTask", () => {
  it("stores one log with the stored data and writes its file", async () => {
    const t = mergedTask({ plan: "1. do it" });
    amendBrief(t.workspace.id, t.id, "Also cover logout");
    saveItem(t.id, {
      id: "a-final",
      kind: "assistant",
      text: "All done. Verified with the suite.",
      createdAt: Date.now(),
    });
    flushItems();
    db.prepare(
      `INSERT INTO usage_calls (call_key, at, session_id, task_id, role, kind, model, provider,
         input_tokens, output_tokens, source) VALUES ('k1', 1, ?, ?, 'plan', 'main',
         'claude-opus-5-5', 'anthropic', 1000, 2000, 'live')`
    ).run(t.id, t.id);
    db.prepare(
      `INSERT INTO orchestrator_checks (workspace_id, session_id, sha, kind, status, detail)
       VALUES (?, ?, 'aaaaaaa1111', 'review', 'block', 'Blocking: no tests')`
    ).run(t.workspace.id, t.id);
    db.prepare(
      `INSERT INTO orchestrator_gate_failure_commits (session_id, gate, sha, workspace_id, reason)
       VALUES (?, 'ci', 'aaaaaaa1111', ?, 'CI failed on aaaaaaa (<untrusted source="CI">unit</untrusted>)')`
    ).run(t.id, t.workspace.id);

    await captureMergedTask(t.id, { head: "bbbbbbb2222" });

    const log = getLog(t.id)!;
    expect(log.workspace_id).toBe(t.workspace.id);
    expect(log.project_id).toBe(t.api.id);
    expect(log.markdown).toContain("Add auth");
    expect(log.markdown).toContain("Also cover logout");
    expect(log.markdown).toContain("1. do it");
    expect(log.markdown).toContain("Blocking: no tests");
    expect(log.markdown).toContain("failing check: unit");
    expect(log.markdown).toContain("All done. Verified with the suite.");
    expect(log.markdown).toContain("anthropic/claude-opus-5-5");
    expect(log.markdown).toContain("`bbbbbbb2222 (PR head)`");
    expect(JSON.parse(log.data)).toMatchObject({ prNumber: 7, hasPlan: true });
    expect(log.file_path).toMatch(/\d{4}-\d\d-\d\d-add-auth\.md$/);
    expect(fs.readFileSync(log.file_path!, "utf8")).toBe(log.markdown);
    expect(path.basename(log.file_path!)).toMatch(/^2026-10-12-/);
    expect(listLogs({ projectId: t.api.id })).toHaveLength(1);
  });

  it("makes one log when the merge path runs twice, even at once", async () => {
    const t = mergedTask();
    await Promise.all([captureMergedTask(t.id), captureMergedTask(t.id)]);
    await captureMergedTask(t.id);
    resetSessionLogState();
    await captureMergedTask(t.id);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM session_logs`).get()).toEqual({
      n: 1,
    });
    expect(fs.readdirSync(path.join(dir, t.id))).toHaveLength(1);
  });

  it("reads the plan before cleanup removes the worktree", async () => {
    const t = mergedTask({ plan: "the plan" });
    const pending = captureMergedTask(t.id);
    fs.rmSync(t.worktree, { recursive: true });
    await pending;
    expect(getLog(t.id)!.markdown).toContain("the plan");
  });

  it("logs a task merged on GitHub that AgentOS still has as running", async () => {
    const t = mergedTask({ status: "running" });
    await captureMergedTask(t.id);
    expect(getLog(t.id)).not.toBeNull();
  });

  it("writes nothing for a dropped, unmerged or plain session", async () => {
    const dropped = mergedTask({ status: "dropped" });
    db.prepare(`UPDATE sessions SET pr_status = 'closed' WHERE id = ?`).run(
      dropped.id
    );
    const open = mergedTask({ status: "running" });
    db.prepare(`UPDATE sessions SET pr_status = 'open' WHERE id = ?`).run(
      open.id
    );
    const plain = mergedTask();
    db.prepare(`UPDATE sessions SET task_prompt = NULL WHERE id = ?`).run(
      plain.id
    );
    await Promise.all(
      [dropped, open, plain].map((t) => captureMergedTask(t.id))
    );
    expect(db.prepare(`SELECT COUNT(*) AS n FROM session_logs`).get()).toEqual({
      n: 0,
    });
  });

  it("never rejects when the builder throws, and a later call still logs", async () => {
    const t = mergedTask();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(buildLogMarkdown).mockImplementationOnce(() => {
      throw new Error("template broke");
    });
    await expect(captureMergedTask(t.id)).resolves.toBeUndefined();
    expect(getLog(t.id)).toBeNull();
    expect(error).toHaveBeenCalled();
    // The merge itself is untouched.
    expect(
      db.prepare(`SELECT task_status FROM sessions WHERE id = ?`).get(t.id)
    ).toEqual({ task_status: "merged" });
    await captureMergedTask(t.id);
    expect(getLog(t.id)).not.toBeNull();
    error.mockRestore();
  });

  it("keeps the log when its file can't be written", async () => {
    const t = mergedTask();
    const blocker = path.join(dir, `${t.id}-file`);
    fs.writeFileSync(blocker, "x");
    setLogFolder(t.api.id, path.join(blocker, "inside"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await captureMergedTask(t.id);
    expect(getLog(t.id)).not.toBeNull();
    expect(getLog(t.id)!.file_path).toBeNull();
    error.mockRestore();
  });

  it("returns at once for an unknown session", async () => {
    await expect(captureMergedTask("nope")).resolves.toBeUndefined();
  });

  it("calls no model, driver or network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const t = mergedTask({ plan: "p" });
    await captureMergedTask(t.id);
    expect(getLog(t.id)).not.toBeNull();
    expect(modelCalls.query).not.toHaveBeenCalled();
    expect(modelCalls.runClaude).not.toHaveBeenCalled();
    expect(modelCalls.chatDriverFor).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("has no path to a model in its imports", () => {
    const forbidden =
      /claude-agent-sdk|claude-cli|chat\/drivers|chat\/worker|orchestrator\/(review|scope|act)|providers|child_process|from "node:child_process"/;
    const here = path.dirname(new URL(import.meta.url).pathname);
    for (const f of fs.readdirSync(here)) {
      if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
      const imports = fs
        .readFileSync(path.join(here, f), "utf8")
        .split("\n")
        .filter((l) => /^\s*(import|export) .* from /.test(l));
      for (const l of imports) expect(`${f}: ${l}`).not.toMatch(forbidden);
    }
  });
});

describe("merged time and rewrite", () => {
  beforeEach(() => {
    vi.stubEnv("AGENTOS_SESSION_LOGS_NO_GH", "");
    return () => vi.unstubAllEnvs();
  });

  const ghJson = (mergedAt: string | null) =>
    JSON.stringify({
      mergeCommit: { oid: "a".repeat(40) },
      mergedAt,
    });

  it("prefers merged_at, then GitHub's mergedAt, then unknown", async () => {
    const a = mergedTask();
    modelCalls.gh.mockResolvedValue(ghJson("2026-10-13T01:02:03Z"));
    await captureMergedTask(a.id);
    expect(getLog(a.id)!.markdown).toContain(
      "**Merged:** 2026-10-12 10:15 UTC"
    );

    const b = mergedTask();
    db.prepare(`UPDATE sessions SET merged_at = NULL WHERE id = ?`).run(b.id);
    await captureMergedTask(b.id);
    const md = getLog(b.id)!.markdown;
    expect(md).toContain("**Merged:** 2026-10-13 01:02 UTC");
    expect(md).toContain(`\`${"a".repeat(40)}\``);

    const c = mergedTask();
    db.prepare(
      `UPDATE sessions SET merged_at = NULL, updated_at = '2026-10-20 00:00:00' WHERE id = ?`
    ).run(c.id);
    modelCalls.gh.mockResolvedValue(ghJson(null));
    await captureMergedTask(c.id);
    const unknown = getLog(c.id)!.markdown;
    expect(unknown).toContain("**Merged:** unknown");
    expect(unknown).not.toContain("**Duration:**");
    expect(unknown).not.toContain("2026-10-20");
  });

  it("rewrites a log and its file in place, and a dry run changes nothing", async () => {
    const t = mergedTask({ plan: "1. keep me" });
    await captureMergedTask(t.id);
    const before = getLog(t.id)!;
    db.prepare(
      `UPDATE session_logs SET markdown = replace(markdown, 'Merge commit:** unknown', 'Merge commit:** [redacted]') WHERE session_id = ?`
    ).run(t.id);
    modelCalls.gh.mockResolvedValue(ghJson(null));

    expect(await writeLog(t.id, { rewrite: true, dryRun: true })).toBe(true);
    expect(getLog(t.id)!.markdown).not.toBe(before.markdown);
    expect(getLog(t.id)!.markdown).toContain("[redacted]");

    expect(await writeLog(t.id, { rewrite: true })).toBe(true);
    const after = getLog(t.id)!;
    expect(after.created_at).toBe(before.created_at);
    expect(after.file_path).toBe(before.file_path);
    expect(after.markdown).toContain(`\`${"a".repeat(40)}\``);
    expect(after.markdown).toContain("1. keep me");
    expect(fs.readFileSync(after.file_path!, "utf8")).toBe(after.markdown);
    expect(await writeLog(t.id, { rewrite: true })).toBe(false);
  });
});
