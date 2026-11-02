import "./signoff.test-helpers";
import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import type { SessionFacts } from "./facts";
import {
  ATTRIBUTED,
  BRAKE_SUBJECT,
  HOLD_MAX_MS,
  HOLD_MIN_MS,
  S,
  answerAsk,
  askUp,
  commit,
  db,
  updateSessionRow,
  ensureOrchestrator,
  failingCI,
  failureOf,
  followAskHeads,
  getAsk,
  getCheck,
  git,
  landDeps,
  listItems,
  listNotes,
  merges,
  oneGateAsk,
  openAsks,
  raiseAsk,
  raiseHeldAsks,
  refundIfRefused,
  releaseInterruptedClaims,
  reviewNow,
  runTool,
  setMergeApprovals,
  setup,
  spendApproval,
  stackQueries,
  taskFacts,
} from "./signoff.test-helpers";

describe("sign_off", () => {
  it("fails a gate, then passes and merges at the reviewed commit", async () => {
    const t = setup();
    await reviewNow(t.w);
    S.pr = { ...S.pr!, checks: "fail", failing: "unit" };
    await expect(t.signOff()).rejects.toThrow(
      /- ci failed \(first\): CI failed on .* \(<untrusted source="CI">unit<\/untrusted>\)/
    );
    expect(failureOf(t.task, "ci")?.count).toBe(1);

    S.pr = { ...S.pr!, checks: "pass", failing: null };
    await expect(t.signOff()).resolves.toMatch(
      /Merged add-a: PR #7 squash-merged/
    );
    expect(merges).toEqual([
      ["pr", "merge", "7", "--squash", "--match-head-commit", t.sha],
    ]);
    const row = db
      .prepare(`SELECT task_status FROM session_rows WHERE id = ?`)
      .get(t.task);
    expect(row).toEqual({ task_status: "merged" });
    expect(listNotes(t.w).at(-1)?.text).toMatch(/Merged add-a \(PR #7/);
  });

  it("closes asks about the PR once the sign-off merges it", async () => {
    const t = setup();
    await reviewNow(t.w);
    await runTool(t.w, "ask_owner", {
      title: "Re-approve PR #7 after the merge with main?",
      detail: "main moved",
      kind: "decision",
      link: "https://github.com/o/r/pull/7",
    });
    await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
    expect(openAsks(t.w)).toEqual([]);
    const row = db
      .prepare(
        `SELECT status, answer FROM orchestrator_asks WHERE workspace_id = ?`
      )
      .get(t.w);
    expect(row).toEqual({
      status: "resolved",
      answer: `PR #7 merged at ${t.sha.slice(0, 7)} by sign-off`,
    });
  });

  it("still finishes the merge when closing its asks fails", async () => {
    const t = setup();
    await reviewNow(t.w);
    await runTool(t.w, "ask_owner", {
      title: "Re-approve PR #7?",
      detail: "main moved",
      kind: "decision",
      link: "https://github.com/o/r/pull/7",
    });
    const trigger = `no_close_${t.w.replace(/\W/g, "")}`;
    db.exec(
      `CREATE TRIGGER ${trigger} BEFORE UPDATE ON orchestrator_asks
       WHEN NEW.workspace_id = '${t.w}' BEGIN SELECT RAISE(ABORT, 'boom'); END`
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
      expect(
        db
          .prepare(`SELECT task_status FROM session_rows WHERE id = ?`)
          .get(t.task)
      ).toEqual({ task_status: "merged" });
      expect(logged.mock.calls.flat().join(" ")).toMatch(/closing stale asks/);
    } finally {
      logged.mockRestore();
      db.exec(`DROP TRIGGER ${trigger}`);
    }
  });

  it("refuses a PR whose body carries AI attribution, reviewed or not", async () => {
    const t = setup();
    await reviewNow(t.w);
    S.pr = { ...S.pr!, attribution: ATTRIBUTED };
    await expect(t.signOff()).rejects.toThrow(
      /- code-review failed \(first\): the PR body carries AI attribution/
    );
    // An unread body is the same head's one failure.
    S.pr = { ...S.pr!, attribution: undefined };
    await expect(t.signOff()).rejects.toThrow(
      /code-review failed \(first\): the PR body couldn't be read/
    );
    expect(merges).toEqual([]);
  });

  it("needs no Code review section: the independent review of the head is the code review", async () => {
    const t = setup();
    // No review yet: the review gate waits, and only it says so.
    const first = await t.signOff().catch((e: Error) => e.message);
    expect(first).toMatch(/review: not yet, no review of/);
    expect(first).not.toMatch(/code-review/);
    await reviewNow(t.w);
    await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
  });

  // The task's PR is a stack item whose branch AgentOS restacked from the
  // reviewed commit to the head it pushed.
  function restacked(t: ReturnType<typeof setup>, from: string, to: string) {
    const { project_id } = db
      .prepare(`SELECT project_id FROM sessions WHERE id = ?`)
      .get(t.task) as { project_id: string };
    const id = `item-${t.task}`;
    stackQueries.create(
      db,
      {
        id: `stack-${t.task}`,
        project_id,
        lh_board_id: `board-${t.task}`,
        name: "s",
        max_parallel: 3,
      },
      [
        {
          id,
          position: 0,
          lh_card_id: `card-${t.task}`,
          ticket: "T-1",
          title: "t",
          parent_item_id: null,
          also_item_ids: "[]",
          blocker_item_ids: "[]",
          status: "pr",
          session_id: t.task,
          base_branch: "main",
          base_tip: null,
          note: null,
          held_outside: 0,
        },
      ]
    );
    stackQueries.updateItem(db, id, {
      restacked_from: from,
      restacked_to: to,
    });
  }

  it("accepts a review of the commit AgentOS restacked into the head", async () => {
    const t = setup();
    const head = t.push("b.txt", "b\n");
    restacked(t, t.sha, head);
    await reviewNow(t.w);
    await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
  });

  it("escalates the same CI failure on a second commit, and then holds the task for the owner", async () => {
    const t = setup();
    await reviewNow(t.w);
    S.pr = failingCI();
    await expect(t.signOff()).rejects.toThrow(/ci failed \(first\)/);
    // The same head judged again isn't another failure.
    await expect(t.signOff()).rejects.toThrow(/ci failed \(first\)/);
    const next = t.push("src/b.ts", "export const b = 2;\n");
    await reviewNow(t.w);
    await expect(t.signOff()).rejects.toThrow(
      /ci failed \(again, 2 of 4 in a row\)[\s\S]*Escalated to the owner: the ci gate failed the same way on two commits in a row/
    );
    // The ask waits for the agent; the task is held meanwhile.
    expect(openAsks(t.w)).toEqual([]);
    await askUp(t.w, t.task);
    const notes = listNotes(t.w).filter((n) => n.kind === "escalation");
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toMatch(
      /^The owner must decide on add-a \(https:\/\/github.com\/o\/r\/pull\/7\)/
    );
    const orch = ensureOrchestrator(t.w);
    expect(listItems(orch.id).at(-1)).toMatchObject({
      kind: "note",
      tone: "escalation",
    });

    S.pr = { ...S.pr!, checks: "pass", failing: null };
    await expect(t.signOff()).rejects.toThrow(
      /is with the owner \(ci: .*\)\. Only he can merge it now/
    );
    expect(merges).toEqual([]);
    oneGateAsk(t.w, t.task, next);
  });

  it("merges a held task once, on the owner's approval of that exact commit", async () => {
    const t = setup({ approvals: true });
    t.push(".github/workflows/ci.yml", "on: push\n");
    await reviewNow(t.w);
    await expect(t.signOff()).rejects.toThrow(/Escalated to the owner/);
    const ask = oneGateAsk(t.w, t.task, S.pr!.head!);
    answerAsk(t.w, ask.id, { action: "approve" });
    await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
    expect(merges).toEqual([
      ["pr", "merge", "7", "--squash", "--match-head-commit", S.pr!.head!],
    ]);
    expect(getAsk(t.w, ask.id)?.used_at).toBeTruthy();
    expect(listNotes(t.w).at(-1)?.text).toMatch(/on the owner's approval/);
  });

  it("keeps the owner's approval when GitHub refuses the merge, and spends it on the merge that happens", async () => {
    const t = setup({ approvals: true });
    t.push(".github/workflows/ci.yml", "on: push\n");
    await reviewNow(t.w);
    await expect(t.signOff()).rejects.toThrow(/Escalated to the owner/);
    const ask = oneGateAsk(t.w, t.task, S.pr!.head!);
    answerAsk(t.w, ask.id, { action: "approve" });

    S.refuseMerge = 'GraphQL: Required status check "Check" is failing';
    await expect(t.signOff()).rejects.toThrow(/is failing/);
    expect(getAsk(t.w, ask.id)?.used_at).toBeNull();

    S.refuseMerge = null;
    await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
    expect(getAsk(t.w, ask.id)?.used_at).toBeTruthy();
  });

  it("gives a land's claimed approval back when that merge is refused", async () => {
    const t = setup({ approvals: true });
    t.push(".github/workflows/ci.yml", "on: push\n");
    await reviewNow(t.w);
    await expect(t.signOff()).rejects.toThrow(/Escalated to the owner/);
    const ask = oneGateAsk(t.w, t.task, S.pr!.head!);
    answerAsk(t.w, ask.id, { action: "approve" });

    const deps = landDeps(t.w);
    await expect(deps.beforeMerge(t.task)).resolves.toEqual({
      head: S.pr!.head,
    });
    expect(getAsk(t.w, ask.id)?.used_at).toBeTruthy();
    S.refuseMerge = "GraphQL: Head branch was modified";
    await expect(deps.signOff(t.task, S.pr!.head)).rejects.toThrow(/modified/);
    expect(getAsk(t.w, ask.id)?.used_at).toBeNull();
    expect(merges).toEqual([]);
  });

  it("keeps the approval spent when the merge happened and a later step failed", async () => {
    const t = setup({ approvals: true });
    t.push(".github/workflows/ci.yml", "on: push\n");
    await reviewNow(t.w);
    await expect(t.signOff()).rejects.toThrow(/Escalated to the owner/);
    const ask = oneGateAsk(t.w, t.task, S.pr!.head!);
    answerAsk(t.w, ask.id, { action: "approve" });

    const deps = landDeps(t.w);
    await deps.beforeMerge(t.task);
    await expect(
      refundIfRefused(t.task, ask.id, async () => {
        updateSessionRow(db, t.task, { task_status: "merged" });
        throw new Error("restack failed");
      })
    ).rejects.toThrow(/restack failed/);
    expect(getAsk(t.w, ask.id)?.used_at).toBeTruthy();
  });

  it("asks again when the head moved after the owner approved", async () => {
    const t = setup({ approvals: true });
    t.push(".github/workflows/ci.yml", "on: push\n");
    await reviewNow(t.w);
    await expect(t.signOff()).rejects.toThrow(/Escalated to the owner/);
    const first = oneGateAsk(t.w, t.task, S.pr!.head!);
    answerAsk(t.w, first.id, { action: "approve" });
    const next = t.push("src/b.ts", "export const b = 2;\n");
    await expect(t.signOff()).rejects.toThrow(
      new RegExp(
        `The owner approved ${first.sha!.slice(0, 7)}, but PR #7's head is now ${next.slice(0, 7)}`
      )
    );
    await expect(t.signOff()).rejects.toThrow(/Asked him again/);
    expect(oneGateAsk(t.w, t.task, next).id).not.toBe(first.id);
    expect(merges).toEqual([]);
  });

  // The base moves and the task rebases onto it, as #210 did to renumber a
  // migration; `edit` also changes the PR's own patch.
  function rebaseOnMain(
    t: ReturnType<typeof setup>,
    edit?: [string, string]
  ): string {
    git(t.repo, "checkout", "-q", "main");
    commit(t.repo, "docs/moved.md", `moved ${Math.random()}\n`);
    git(t.repo, "checkout", "-q", "feature/t");
    git(t.repo, "rebase", "-q", "main");
    if (edit) {
      fs.mkdirSync(path.dirname(path.join(t.repo, edit[0])), {
        recursive: true,
      });
      fs.writeFileSync(path.join(t.repo, edit[0]), edit[1]);
      git(t.repo, "add", "-A");
      git(t.repo, "commit", "-qm", `change ${edit[0]}`);
    }
    git(t.repo, "push", "-qf", "origin", "HEAD");
    S.pr = { ...S.pr!, head: git(t.repo, "rev-parse", "HEAD") };
    return S.pr.head!;
  }

  it("carries the owner's approval over a clean rebase with the same patch", async () => {
    const t = setup({ approvals: true });
    t.push(".github/workflows/ci.yml", "on: push\n");
    await reviewNow(t.w);
    await expect(t.signOff()).rejects.toThrow(/Escalated to the owner/);
    const ask = oneGateAsk(t.w, t.task, S.pr!.head!);
    answerAsk(t.w, ask.id, { action: "approve" });
    const next = rebaseOnMain(t);
    expect(next).not.toBe(ask.sha);
    await reviewNow(t.w);
    await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
    expect(merges).toEqual([
      ["pr", "merge", "7", "--squash", "--match-head-commit", next],
    ]);
    expect(getAsk(t.w, ask.id)).toMatchObject({ sha: next });
    expect(getAsk(t.w, ask.id)?.used_at).toBeTruthy();
    expect(listNotes(t.w).some((n) => /carries to/.test(n.text))).toBe(true);
    expect(openAsks(t.w)).toEqual([]);
  });

  it("doesn't carry the approval when the patch changed, and the re-ask says what", async () => {
    const t = setup({ approvals: true });
    t.push(".github/workflows/ci.yml", "on: push\n");
    await reviewNow(t.w);
    await expect(t.signOff()).rejects.toThrow(/Escalated to the owner/);
    const first = oneGateAsk(t.w, t.task, S.pr!.head!);
    answerAsk(t.w, first.id, { action: "approve" });
    const next = rebaseOnMain(t, ["src/b.ts", "export const b = 2;\n"]);
    await expect(t.signOff()).rejects.toThrow(
      new RegExp(
        `The owner approved ${first.sha!.slice(0, 7)}, but PR #7's head is now ${next.slice(0, 7)} and its patch changed: now also touches src/b.ts`
      )
    );
    const again = oneGateAsk(t.w, t.task, next);
    expect(again.id).not.toBe(first.id);
    expect(again.detail).toMatch(/now also touches src\/b\.ts/);
    expect(getAsk(t.w, first.id)?.used_at).toBeNull();
    expect(merges).toEqual([]);
  });

  it("moves an open ask to the head it would merge", async () => {
    const t = setup({ approvals: true });
    t.push(".github/workflows/ci.yml", "on: push\n");
    await reviewNow(t.w);
    await expect(t.signOff()).rejects.toThrow(/Escalated to the owner/);
    const ask = oneGateAsk(t.w, t.task, S.pr!.head!);
    const facts = () =>
      [{ id: t.task, task: { pr: S.pr } }] as unknown as SessionFacts[];
    const next = rebaseOnMain(t);
    await followAskHeads(t.w, facts());
    const moved = oneGateAsk(t.w, t.task, next);
    expect(moved.id).toBe(ask.id);
    expect(moved.detail).toMatch(/Head moved from .* same patch/);
    // A screen that still shows the old commit can't approve it.
    expect(() =>
      answerAsk(t.w, ask.id, { action: "approve" }, ask.sha!)
    ).toThrow(/changed since you saw it/);
    // A real change replaces the line instead of stacking another.
    const last = rebaseOnMain(t, ["src/c.ts", "export const c = 3;\n"]);
    await followAskHeads(t.w, facts());
    const again = oneGateAsk(t.w, t.task, last);
    expect(again.detail).toMatch(/patch changed: now also touches src\/c\.ts/);
    expect(again.detail.match(/Head moved from/g)).toHaveLength(1);
    answerAsk(t.w, ask.id, { action: "approve" }, last);
    await reviewNow(t.w);
    await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
  });

  it("keeps an ask on the head it was raised at when the facts still hold the old head", async () => {
    const t = setup({ approvals: true });
    t.push(".github/workflows/ci.yml", "on: push\n");
    await reviewNow(t.w);
    await expect(t.signOff()).rejects.toThrow(/Escalated to the owner/);
    const first = oneGateAsk(t.w, t.task, S.pr!.head!);
    answerAsk(t.w, first.id, { action: "approve" });
    const stale = S.pr;
    const next = t.push("src/b.ts", "export const b = 2;\n");
    await expect(t.signOff()).rejects.toThrow(/Asked him again/);
    const second = oneGateAsk(t.w, t.task, next);
    // The tick's facts were taken before the push.
    await followAskHeads(t.w, [
      { id: t.task, task: { pr: stale } },
    ] as unknown as SessionFacts[]);
    const kept = oneGateAsk(t.w, t.task, next);
    expect(kept.id).toBe(second.id);
    expect(kept.detail).not.toMatch(/Head moved from/);
    answerAsk(t.w, second.id, { action: "approve" }, next);
    await reviewNow(t.w);
    await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
    expect(merges).toEqual([
      ["pr", "merge", "7", "--squash", "--match-head-commit", next],
    ]);
  });

  it("never moves an ask back to an ancestor of its commit", async () => {
    const t = setup({ approvals: true });
    const a = t.push(".github/workflows/ci.yml", "on: push\n");
    const b = t.push("src/b.ts", "export const b = 2;\n");
    await reviewNow(t.w);
    await expect(t.signOff()).rejects.toThrow(/Escalated to the owner/);
    oneGateAsk(t.w, t.task, b);
    // GitHub itself still says the older commit.
    S.pr = { ...S.pr!, head: a };
    await followAskHeads(t.w, [
      { id: t.task, task: { pr: S.pr } },
    ] as unknown as SessionFacts[]);
    expect(oneGateAsk(t.w, t.task, b).detail).not.toMatch(/Head moved from/);
  });

  describe("an ask held until the agent is done", () => {
    // CI failing the same way on two commits, so the loop guard holds the ask.
    async function escalated() {
      const t = setup();
      await reviewNow(t.w);
      S.pr = failingCI();
      await expect(t.signOff()).rejects.toThrow(/ci failed \(first\)/);
      t.push("src/b.ts", "export const b = 2;\n");
      await reviewNow(t.w);
      await expect(t.signOff()).rejects.toThrow(/Escalated to the owner/);
      expect(openAsks(t.w)).toEqual([]);
      return t;
    }
    const later = (ms: number) => Date.now() + ms;

    it("waits while the agent works, then asks at the head it pushed", async () => {
      const t = await escalated();
      await raiseHeldAsks(
        t.w,
        taskFacts(t.task, "running"),
        later(HOLD_MIN_MS + 1000)
      );
      expect(openAsks(t.w)).toEqual([]);
      // The fix is pushed and its CI is still running.
      const fix = t.push("src/c.ts", "export const c = 3;\n");
      S.pr = { ...S.pr!, checks: "pending", failing: null };
      await raiseHeldAsks(t.w, taskFacts(t.task), later(HOLD_MIN_MS + 1000));
      expect(openAsks(t.w)).toEqual([]);
      S.pr = { ...S.pr!, checks: "pass" };
      await askUp(t.w, t.task);
      const ask = oneGateAsk(t.w, t.task, fix);
      expect(ask.detail).toMatch(
        /the ci gate failed the same way on two commits in a row \(unit: src\/a.test.ts > adds\)/
      );
      expect(ask.detail).toMatch(new RegExp(`Asked at ${fix.slice(0, 7)}`));
      expect(
        listNotes(t.w).filter((n) => n.kind === "escalation")
      ).toHaveLength(1);
      await askUp(t.w, t.task);
      expect(openAsks(t.w)).toHaveLength(1);
    });

    it("waits out the minimum hold and a recent message to the task", async () => {
      const t = await escalated();
      await raiseHeldAsks(t.w, taskFacts(t.task), later(1000));
      expect(openAsks(t.w)).toEqual([]);
      // Stamped ahead, so it is recent at the simulated times below.
      const orch = ensureOrchestrator(t.w);
      db.prepare(
        `INSERT INTO bus_messages (from_id, from_name, to_id, to_name, body, created_at) VALUES (?, 'orch', ?, 'add-a', 'fix the bug', datetime('now', '+4 minutes'))`
      ).run(orch.id, t.task);
      await raiseHeldAsks(t.w, taskFacts(t.task), later(HOLD_MIN_MS + 1000));
      expect(openAsks(t.w)).toEqual([]);
      await raiseHeldAsks(t.w, taskFacts(t.task), later(10 * 60 * 1000));
      oneGateAsk(t.w, t.task, S.pr!.head!);
    });

    it("moves the one open ask when the head moves after it's raised", async () => {
      const t = await escalated();
      S.pr = { ...S.pr!, checks: "pass", failing: null };
      await askUp(t.w, t.task);
      const ask = oneGateAsk(t.w, t.task, S.pr!.head!);
      const next = t.push("src/d.ts", "export const d = 4;\n");
      await followAskHeads(t.w, taskFacts(t.task));
      expect(oneGateAsk(t.w, t.task, next).id).toBe(ask.id);
      await askUp(t.w, t.task);
      expect(openAsks(t.w)).toHaveLength(1);
    });

    it("asks after an hour even if the agent never goes idle", async () => {
      const t = await escalated();
      await raiseHeldAsks(
        t.w,
        taskFacts(t.task, "running"),
        later(HOLD_MAX_MS + 1000)
      );
      expect(oneGateAsk(t.w, t.task, S.pr!.head!).detail).toMatch(
        /still working after an hour/
      );
    });

    it("asks after an hour while CI is still pending", async () => {
      const t = await escalated();
      S.pr = { ...S.pr!, checks: "pending", failing: null };
      await raiseHeldAsks(t.w, taskFacts(t.task), later(HOLD_MIN_MS + 1000));
      expect(openAsks(t.w)).toEqual([]);
      await raiseHeldAsks(
        t.w,
        taskFacts(t.task, "running"),
        later(HOLD_MAX_MS + 1000)
      );
      expect(oneGateAsk(t.w, t.task, S.pr!.head!).detail).toMatch(
        /still working after an hour/
      );
    });

    it("asks after an hour even without session facts", async () => {
      const t = await escalated();
      await raiseHeldAsks(t.w, [], later(HOLD_MIN_MS + 1000));
      expect(openAsks(t.w)).toEqual([]);
      await raiseHeldAsks(t.w, [], later(HOLD_MAX_MS + 1000));
      oneGateAsk(t.w, t.task, S.pr!.head!);
    });

    it("keeps the hold when gh fails, and releases it when the PR is closed", async () => {
      const t = await escalated();
      S.prError = new Error("gh: network down");
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await raiseHeldAsks(t.w, taskFacts(t.task), later(HOLD_MIN_MS + 1000));
      } finally {
        spy.mockRestore();
        S.prError = null;
      }
      expect(openAsks(t.w)).toEqual([]);
      expect(failureOf(t.task, "ci")?.ask_held_at).toBeTruthy();
      S.pr = { ...S.pr!, state: "CLOSED" };
      await raiseHeldAsks(t.w, taskFacts(t.task), later(HOLD_MIN_MS + 1000));
      expect(failureOf(t.task, "ci")?.ask_held_at).toBeNull();
    });

    it("drops the hold when the task is no longer running", async () => {
      const t = await escalated();
      updateSessionRow(db, t.task, { task_status: "dropped" });
      await askUp(t.w, t.task);
      expect(openAsks(t.w)).toEqual([]);
      expect(failureOf(t.task, "ci")?.ask_held_at).toBeNull();
    });
  });

  // Approves the first commit, moves the head, and approves the new one too.
  async function approveTwice(t: ReturnType<typeof setup>) {
    t.push(".github/workflows/ci.yml", "on: push\n");
    await reviewNow(t.w);
    await expect(t.signOff()).rejects.toThrow(/Escalated to the owner/);
    const first = oneGateAsk(t.w, t.task, S.pr!.head!);
    answerAsk(t.w, first.id, { action: "approve" });
    const next = t.push("src/b.ts", "export const b = 2;\n");
    await expect(t.signOff()).rejects.toThrow(/Asked him again/);
    const second = oneGateAsk(t.w, t.task, next);
    answerAsk(t.w, second.id, { action: "approve" });
    return { first, second, next };
  }

  it("with two approvals for different commits, merges on the newest", async () => {
    const t = setup({ approvals: true });
    const { first, second, next } = await approveTwice(t);
    await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
    expect(merges).toEqual([
      ["pr", "merge", "7", "--squash", "--match-head-commit", next],
    ]);
    expect(getAsk(t.w, second.id)?.used_at).toBeTruthy();
    expect(getAsk(t.w, first.id)?.used_at).toBeNull();
  });

  it("honours an approval whose merge a restart cut off", async () => {
    const t = setup({ approvals: true });
    const { first, second, next } = await approveTwice(t);
    // sign_off claimed it, then the server died before merging or giving
    // it back.
    expect(spendApproval(second.id)).toBe(true);
    // The older approval, of a commit that's gone, doesn't stand in for it.
    await expect(t.signOff()).rejects.toThrow(/is with the owner/);
    expect(openAsks(t.w)).toEqual([]);

    expect(releaseInterruptedClaims()).toBe(1);
    await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
    expect(merges).toEqual([
      ["pr", "merge", "7", "--squash", "--match-head-commit", next],
    ]);
    expect(getAsk(t.w, second.id)?.used_at).toBeTruthy();
    expect(getAsk(t.w, first.id)?.used_at).toBeNull();
  });

  it("keeps a used brake approval and a voided one spent across a restart", async () => {
    const t = setup({ approvals: true });
    const { second } = await approveTwice(t);
    spendApproval(second.id);
    db.prepare(
      `UPDATE orchestrator_asks SET answer = 'approve (void)' WHERE id = ?`
    ).run(second.id);
    const { ask: brake } = raiseAsk({
      workspaceId: t.w,
      subject: BRAKE_SUBJECT,
      kind: "brake",
      title: "Start past the brakes?",
      brakeKey: "spend",
    });
    answerAsk(t.w, brake.id, { action: "approve" });
    expect(spendApproval(brake.id)).toBe(true);

    expect(releaseInterruptedClaims()).toBe(0);
    expect(getAsk(t.w, second.id)?.used_at).toBeTruthy();
    expect(getAsk(t.w, brake.id)?.used_at).toBeTruthy();
  });

  it("keeps a claim on a merged task spent across a restart", async () => {
    const t = setup({ approvals: true });
    const { second } = await approveTwice(t);
    await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
    releaseInterruptedClaims();
    expect(getAsk(t.w, second.id)?.used_at).toBeTruthy();
  });

  it("fails the review gate on blocking findings", async () => {
    const t = setup();
    const { text } = await reviewNow(t.w, "block");
    expect(text).toMatch(
      /blocking findings[\s\S]*\[blocking\] src\/a.ts:1: off by one/
    );
    await expect(t.signOff()).rejects.toThrow(
      /review failed \(first\): .*off by one/
    );
  });

  it("fails the blocked gate on a BLOCKED: line or a waiting prompt", async () => {
    const t = setup();
    await reviewNow(t.w);
    S.pane = "working\n⏺ BLOCKED: need the staging key\n❯ ";
    await expect(t.signOff()).rejects.toThrow(
      /blocked failed \(first\): the task is BLOCKED: <untrusted source="add-a">need the staging key<\/untrusted>/
    );
    S.pane = "Run tests?\nAllow? (y/n)";
    await expect(t.signOff()).rejects.toThrow(
      /blocked failed \(first\): the task is waiting on an answer/
    );
  });

  it("checks a card's task against its card, stored with the review", async () => {
    const t = setup({ card: true });
    const { runs } = await reviewNow(t.w, "pass", false);
    expect(runs.map((r) => r.tools.length)).toEqual([3, 0]);
    expect(getCheck(t.task, t.sha, "scope")?.status).toBe("block");
    await expect(t.signOff()).rejects.toThrow(
      /scope failed \(first\): the scope check .* out of scope: <untrusted source="scope check">adds billing/
    );
  });

  it("fails scope on a secret in the diff", async () => {
    const t = setup();
    t.push(
      "src/config.ts",
      'export const KEY = "ghp_abcdefghijklmnopqrstuvwxyz123456";\n'
    );
    await reviewNow(t.w);
    await expect(t.signOff()).rejects.toThrow(
      /scope failed \(first\): it adds what looks like a secret/
    );
  });

  it("never merges CI, deploy or secrets-handling changes, whatever the gates say", async () => {
    const t = setup({ approvals: true });
    t.push(".github/workflows/ci.yml", "on: push\n");
    await reviewNow(t.w);
    await expect(t.signOff()).rejects.toThrow(
      /Escalated to the owner: PR #7 at .* touches \.github\/workflows\/ci\.yml \(CI config\)/
    );
    expect(merges).toEqual([]);
    expect(listNotes(t.w).at(-1)).toMatchObject({ kind: "escalation" });
    await expect(t.signOff()).rejects.toThrow(/is with the owner \(sensitive/);
    oneGateAsk(t.w, t.task, S.pr!.head!);
  });

  it("with merge approvals off, merges security code and CI changes through the gates", async () => {
    const t = setup();
    t.push("lib/security/auth.ts", "export const auth = 1;\n");
    t.push(".github/workflows/ci.yml", "on: push\n");
    await reviewNow(t.w);
    await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
    expect(merges).toEqual([
      ["pr", "merge", "7", "--squash", "--match-head-commit", S.pr!.head!],
    ]);
    expect(openAsks(t.w)).toEqual([]);
  });

  it("with merge approvals off, still holds them to the gates", async () => {
    const t = setup();
    t.push("lib/security/auth.ts", "export const auth = 1;\n");
    await reviewNow(t.w, "block");
    await expect(t.signOff()).rejects.toThrow(/review failed \(first\)/);
    expect(merges).toEqual([]);
  });

  it("lets go of a task held only for approval once approvals are switched off", async () => {
    const t = setup({ approvals: true });
    t.push("lib/security/auth.ts", "export const auth = 1;\n");
    await reviewNow(t.w);
    await expect(t.signOff()).rejects.toThrow(/Escalated to the owner/);
    setMergeApprovals(false);
    await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
  });

  it("keeps holding a task the loop guard stopped when approvals are off", async () => {
    const t = setup();
    await reviewNow(t.w);
    S.pr = failingCI();
    await expect(t.signOff()).rejects.toThrow(/ci failed \(first\)/);
    t.push("src/b.ts", "export const b = 2;\n");
    await reviewNow(t.w);
    await expect(t.signOff()).rejects.toThrow(/Escalated to the owner/);
    S.pr = { ...S.pr!, checks: "pass", failing: null };
    await expect(t.signOff()).rejects.toThrow(/is with the owner \(ci/);
    expect(merges).toEqual([]);
  });
});
