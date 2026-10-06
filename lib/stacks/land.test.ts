import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import { db, stackQueries as q, type Session } from "../db";
import type { TaskPR } from "../tasks/state";
import { landStack, type LandDeps } from "./land";
import { seedStack } from "./testing";

const pr = (n: number, checks: TaskPR["checks"] = "pass"): TaskPR => ({
  number: n,
  url: `https://github.com/o/r/pull/${n}`,
  state: "OPEN",
  checks,
});

function setup(
  checks: (key: string, after: boolean) => TaskPR["checks"] = () => "pass"
) {
  const s = seedStack(mkdtempSync(join(tmpdir(), "land-")), [
    { key: "P", status: "pr", branch: "feature/p", pr: 1 },
    {
      key: "C",
      parent: "P",
      status: "pr",
      branch: "feature/c",
      baseTip: "p-tip",
      pr: 2,
    },
  ]);
  const merged: string[] = [];
  const keyOf = (session: Session) => session.name;
  const deps: LandDeps = {
    signOff: vi.fn(async (sessionId: string) => {
      const item = q.itemForSession(db, sessionId)!;
      merged.push(item.ticket!);
      q.updateItem(db, item.id, { status: "merged" });
      // What the sign-off's restack does to the child.
      if (item.ticket === "P")
        q.updateItem(db, s.item("C").id, { base_tip: "main-tip" });
    }),
    prOf: async (session) =>
      pr(
        keyOf(session) === "P" ? 1 : 2,
        checks(keyOf(session), merged.includes("P"))
      ),
    sleep: vi.fn(async () => {}),
    refresh: async () => {},
    waitMs: 90_000,
    everyMs: 30_000,
  };
  return { s, deps, merged };
}

describe("landStack", () => {
  it("merges bottom-up and waits for the restacked child to go green again", async () => {
    let polls = 0;
    const { s, deps, merged } = setup((key, after) =>
      key === "C" && after && polls++ < 1 ? "pending" : "pass"
    );
    await landStack(s.stackId, deps);
    expect(merged).toEqual(["P", "C"]);
    expect(deps.sleep).toHaveBeenCalledTimes(2);
    expect(q.get(db, s.stackId)).toMatchObject({
      status: "landed",
      progress: "Landed 2: P, C",
    });
  });

  it("refuses with everything missing and merges nothing", async () => {
    const { s, deps, merged } = setup((key) =>
      key === "C" ? "fail" : "pending"
    );
    await landStack(s.stackId, deps);
    expect(merged).toEqual([]);
    const { status, error } = q.get(db, s.stackId)!;
    expect(status).toBe("failed");
    expect(error).toContain("P: CI checks are still running");
    expect(error).toContain("C: CI checks are failing");
  });

  it("stops where a restacked PR goes red, and says what landed", async () => {
    const { s, deps, merged } = setup((key, after) =>
      key === "C" && after ? "fail" : "pass"
    );
    await landStack(s.stackId, deps);
    expect(merged).toEqual(["P"]);
    expect(q.get(db, s.stackId)!.error).toBe(
      "stopped at C, before merging it: CI failed after the restack\nLanded so far: P"
    );
  });

  it("gives up waiting after the limit", async () => {
    const { s, deps, merged } = setup((key, after) =>
      key === "C" && after ? "pending" : "pass"
    );
    await landStack(s.stackId, deps);
    expect(merged).toEqual(["P"]);
    expect(q.get(db, s.stackId)!.error).toContain(
      "CI still pending after 2 min"
    );
  });

  it("asks the gate before each merge and merges only the head it named", async () => {
    const { s, deps, merged } = setup();
    const heads: (string | undefined)[] = [];
    const inner = deps.signOff;
    deps.signOff = vi.fn(async (id: string, head?: string) => {
      heads.push(head);
      await inner(id);
    });
    let asked = 0;
    deps.beforeMerge = vi.fn(async (id: string) => {
      const key = q.itemForSession(db, id)!.ticket;
      // C was restacked: its new head has no review yet, the first time.
      if (key === "C" && asked++ === 0) return { wait: "no review of c2 yet" };
      return { head: key === "P" ? "p1" : "c2" };
    });
    await landStack(s.stackId, deps);
    expect(merged).toEqual(["P", "C"]);
    expect(heads).toEqual(["p1", "c2"]);
    expect(deps.beforeMerge).toHaveBeenCalledTimes(3);
  });

  it("stops the land when the gate refuses an item", async () => {
    const { s, deps, merged } = setup();
    deps.beforeMerge = async (id: string) =>
      q.itemForSession(db, id)!.ticket === "C"
        ? { stop: "review of c2 has blocking findings" }
        : { head: "p1" };
    await landStack(s.stackId, deps);
    expect(merged).toEqual(["P"]);
    expect(q.get(db, s.stackId)!.error).toBe(
      "stopped at C: review of c2 has blocking findings\nLanded so far: P"
    );
  });
});
