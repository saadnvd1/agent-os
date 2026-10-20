import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/db";
import { db, insertSessionRow } from "@/lib/db";
import { machineId } from "@/lib/claims/machine";
import { upsertRemote } from "@/lib/claims/store";
import type { ClaimWire } from "@/lib/claims/types";
import { seedWorkspace } from "@/lib/orchestrator/testing";

process.env.AGENTOS_LOAD = "off";

const started: string[] = [];
vi.mock("@/lib/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks")>()),
  createTask: async (o: { id?: string; projectId: string; prompt: string }) => {
    started.push(o.prompt);
    insertSessionRow(db, {
      id: o.id as string,
      name: o.prompt,
      tmux_name: `claude-${o.id}`,
      working_directory: "/tmp",
      project_id: o.projectId,
      task_status: "running",
      branch_name: "feature/x",
    });
    return { id: o.id, name: o.prompt, branch_name: "feature/x" } as Session;
  },
}));

const { afterMet, queueIfNeeded, tickQueue, listQueue } =
  await import("./queue");
const { afterLabel, row } = await import("./queue-rows");

const wire = (o: Partial<ClaimWire> = {}): ClaimWire => ({
  id: "claim-1",
  origin: "peer-1",
  origin_name: "box",
  hops: 0,
  source: "session",
  session_name: "Add oauth",
  repo: "git.example.test/team/widgets",
  branch: "feature/oauth",
  base: "main",
  goal: "Add oauth",
  files: ["lib/auth.ts"],
  files_more: 0,
  pr_url: null,
  ttl_s: 600,
  age_s: 0,
  released: null,
  ...o,
});

const waitOf = (id: string) =>
  db.prepare(`SELECT wait_code, note FROM task_queue WHERE id = ?`).get(id) as {
    wait_code: string | null;
    note: string | null;
  };

function queueAfter(ref: string) {
  const t = seedWorkspace();
  return queueIfNeeded({
    startedVia: "orchestrator",
    originWorkspaceId: t.workspace.id,
    projectId: t.app.id,
    prompt: "follow-up",
    after: ref,
  })!;
}

beforeEach(() => {
  started.length = 0;
  db.prepare(`DELETE FROM work_claims`).run();
  db.prepare(`UPDATE task_queue SET status = 'removed'`).run();
});

describe("a queued task waiting on a work claim", () => {
  it("waits, says what it waits on, and holds with the after_claim code", async () => {
    upsertRemote(machineId(), "peer-1", wire());
    const q = queueAfter("claim:claim-1");
    expect(q.after).toBe("Add oauth on box");
    expect(row(q.id)!.after_claim).toBe("claim-1");
    await tickQueue();
    expect(started).toEqual([]);
    expect(waitOf(q.id)).toEqual({
      wait_code: "after_claim",
      note: "After Add oauth on box",
    });
    expect(listQueue().find((v) => v.id === q.id)?.wait).toBe("after_claim");
  });

  it("starts once the claim is released", async () => {
    upsertRemote(machineId(), "peer-1", wire());
    queueAfter("claim:claim-1");
    upsertRemote(machineId(), "peer-1", wire({ released: "merged" }));
    await tickQueue();
    expect(started).toEqual(["follow-up"]);
  });

  it("starts once the claim expires", async () => {
    upsertRemote(machineId(), "peer-1", wire());
    queueAfter("claim:claim-1");
    db.prepare(`UPDATE work_claims SET expires_at = ?`).run(Date.now() - 1);
    await tickQueue();
    expect(started).toEqual(["follow-up"]);
  });

  it("refuses a claim that is not live", () => {
    expect(() => queueAfter("claim:nope")).toThrow(/No live work claim/);
    upsertRemote(machineId(), "peer-1", wire({ ttl_s: 0 }));
    expect(() => queueAfter("claim:claim-1")).toThrow(/No live work claim/);
  });

  it("afterMet and afterLabel follow the claim", () => {
    upsertRemote(machineId(), "peer-1", wire());
    const r = row(queueAfter("claim:claim-1").id)!;
    expect(afterMet(r)).toBe(false);
    expect(afterLabel(r)).toBe("Add oauth on box");
    db.prepare(`UPDATE work_claims SET released = 'done'`).run();
    expect(afterMet(r)).toBe(true);
    expect(afterLabel(r)).toBe("a work claim");
  });
});
