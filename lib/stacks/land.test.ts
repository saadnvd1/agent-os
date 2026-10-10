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
  head: `${n}abcdef0`,
  codeReview: { sha: `${n}abcdef` },
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
    stopChat: vi.fn(async () => ({ stopped: true as const })),
    releaseChat: vi.fn(async () => {}),
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

  it("refuses a PR whose body has no code review of its head", async () => {
    const { s, deps, merged } = setup();
    const prOf = deps.prOf;
    deps.prOf = async (session) => {
      const p = (await prOf(session))!;
      return session.name === "P"
        ? { ...p, codeReview: null }
        : { ...p, codeReview: { sha: "0000000" } };
    };
    await landStack(s.stackId, deps);
    expect(merged).toEqual([]);
    const { error } = q.get(db, s.stackId)!;
    expect(error).toContain("P: the PR body has no Code review section");
    expect(error).toContain("C: the PR's code review covers 0000000");
  });

  it("accepts a review of the head AgentOS restacked, while the head is still the restack's", async () => {
    const { s, deps, merged } = setup();
    q.updateItem(db, s.item("C").id, {
      restacked_from: "cccccc11",
      restacked_to: "2abcdef0",
    });
    const prOf = deps.prOf;
    deps.prOf = async (session) => {
      const p = (await prOf(session))!;
      return session.name === "C"
        ? { ...p, codeReview: { sha: "cccccc1" } }
        : p;
    };
    await landStack(s.stackId, deps);
    expect(merged).toEqual(["P", "C"]);
  });

  it("refuses that review once the task pushed after the restack", async () => {
    const { s, deps, merged } = setup();
    q.updateItem(db, s.item("C").id, {
      restacked_from: "cccccc11",
      restacked_to: "ddddddd0",
    });
    const prOf = deps.prOf;
    deps.prOf = async (session) => {
      const p = (await prOf(session))!;
      return session.name === "C"
        ? { ...p, codeReview: { sha: "cccccc1" } }
        : p;
    };
    await landStack(s.stackId, deps);
    expect(merged).toEqual([]);
    expect(q.get(db, s.stackId)!.error).toContain(
      "C: the PR's code review covers cccccc1, not its head 2abcdef"
    );
  });

  it("re-checks each item's review right before merging it, pinned to that head", async () => {
    const { s, deps, merged } = setup();
    const prOf = deps.prOf;
    deps.prOf = async (session) => {
      const p = (await prOf(session))!;
      // C's task pushed an unreviewed commit while P was merging.
      return session.name === "C" && merged.includes("P")
        ? { ...p, head: "3333333aaaa" }
        : p;
    };
    await landStack(s.stackId, deps);
    expect(merged).toEqual(["P"]);
    expect(deps.signOff).toHaveBeenCalledWith(
      s.item("P").session_id,
      "1abcdef0"
    );
    expect(q.get(db, s.stackId)!.error).toContain(
      "stopped at C: the PR's code review covers 2abcdef, not its head 3333333"
    );
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
  describe("with a chat child", () => {
    const asChat = (sessionId: string) =>
      db
        .prepare(`UPDATE sessions SET view = 'chat' WHERE id = ?`)
        .run(sessionId);

    it("stops it between turns before merging, holds it through the land, then lets it go", async () => {
      const { s, deps, merged } = setup();
      const child = s.item("C").session_id!;
      asChat(child);
      let landingWhenStopped = "";
      deps.stopChat = vi.fn(async () => {
        landingWhenStopped = q.get(db, s.stackId)!.status;
        return { stopped: true as const };
      });
      await landStack(s.stackId, deps);
      expect(merged).toEqual(["P", "C"]);
      expect(vi.mocked(deps.stopChat).mock.calls.map(([x]) => x.id)).toEqual([
        child,
      ]);
      // Held: the stack was landing, which is what queues its messages.
      expect(landingWhenStopped).toBe("landing");
      expect(deps.releaseChat).toHaveBeenCalledWith(child);
      expect(q.get(db, s.stackId)!.status).toBe("landed");
    });

    it("refuses before merging anything when one won't stop, and says why", async () => {
      const { s, deps, merged } = setup();
      const child = s.item("C").session_id!;
      asChat(child);
      deps.stopChat = vi.fn(async () => ({
        stopped: false as const,
        reason:
          "its agent's turn was still running after 5 min; try again once it ends",
      }));
      await landStack(s.stackId, deps);
      expect(merged).toEqual([]);
      const { status, error } = q.get(db, s.stackId)!;
      expect(status).toBe("failed");
      expect(error).toContain("these agents didn't stop between turns");
      expect(error).toContain(
        "C: its agent's turn was still running after 5 min"
      );
      expect(error).toContain("nothing was merged");
      // Not left held: what it was sent goes on.
      expect(deps.releaseChat).toHaveBeenCalledWith(child);
    });

    it("stops after a merge whose child's agent was still working, rather than merge it unrestacked", async () => {
      const { s, deps, merged } = setup();
      const signOff = deps.signOff;
      deps.signOff = vi.fn(async (id: string, head?: string) => {
        await signOff(id, head);
        // The restack found its agent busy and left it alone.
        if (q.itemForSession(db, id)!.ticket === "P")
          q.updateItem(db, s.item("C").id, {
            base_tip: "p-tip",
            note: "Waiting for its agent to stop to restack onto main",
          });
      });
      await landStack(s.stackId, deps);
      expect(merged).toEqual(["P"]);
      expect(q.get(db, s.stackId)!.error).toContain(
        "C's agent didn't stop, so it wasn't restacked"
      );
    });
  });
});
