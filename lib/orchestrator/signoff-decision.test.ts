import "./signoff.test-helpers";
import { describe, expect, it } from "vitest";
import type { SessionFacts } from "./facts";
import {
  ATTRIBUTED,
  S,
  answerAsk,
  armTask,
  askUp,
  db,
  failedBefore,
  failingCI,
  failureOf,
  followAskVerdicts,
  getAsk,
  getCheck,
  getTaskSession,
  judge,
  listNotes,
  mergeArmed,
  mergeJudged,
  merges,
  oneGateAsk,
  openAsks,
  putCheck,
  review,
  reviewNow,
  reviewer,
  runTool,
  setup,
  taskFacts,
} from "./signoff.test-helpers";

describe("gate failures count per task and gate", () => {
  const events = (w: string) =>
    (
      db
        .prepare(
          `SELECT line FROM orchestrator_events WHERE workspace_id = ? AND key LIKE '%review:%' ORDER BY id`
        )
        .all(w) as { line: string }[]
    ).map((e) => e.line);

  it("counts a blocking review when its verdict arrives, once per commit, and sends the same findings again to the owner", async () => {
    const t = setup();
    await reviewNow(t.w, "block");
    expect(failureOf(t.task, "review")).toMatchObject({
      count: 1,
      last_sha: t.sha,
    });
    // sign_off reading the same verdict isn't another failure.
    await expect(t.signOff()).rejects.toThrow(/review failed \(first\)/);
    await expect(t.signOff()).rejects.toThrow(/review failed \(first\)/);
    expect(failureOf(t.task, "review")?.count).toBe(1);

    // The task pushes a fix without anyone signing off; it blocks again.
    const next = t.push("src/b.ts", "export const b = 2;\n");
    await reviewNow(t.w, "block");
    expect(failureOf(t.task, "review")).toMatchObject({ count: 2 });
    expect(failureOf(t.task, "review")?.escalated_at).toBeTruthy();
    await askUp(t.w, t.task);
    oneGateAsk(t.w, t.task, next);
    expect(events(t.w).at(-1)).toMatch(
      /review of \w+ found blocking issues; the review gate is stuck in a loop \(the loop guard\), so it's with the owner now/
    );
    await expect(t.signOff()).rejects.toThrow(/is with the owner \(review/);
    expect(merges).toEqual([]);
  });

  it("counts a card task's out-of-scope check the same way", async () => {
    const t = setup({ card: true });
    await reviewNow(t.w, "pass", false);
    // sign_off reading the same verdict isn't another failure.
    await expect(t.signOff()).rejects.toThrow(/scope failed \(first\)/);
    await expect(t.signOff()).rejects.toThrow(/scope failed \(first\)/);
    expect(failureOf(t.task, "scope")).toMatchObject({
      count: 1,
      last_sha: t.sha,
    });
    t.push("src/b.ts", "export const b = 2;\n");
    await reviewNow(t.w, "pass", false);
    expect(failureOf(t.task, "scope")?.count).toBe(2);
    expect(failureOf(t.task, "scope")?.escalated_at).toBeTruthy();
    expect(events(t.w).at(-1)).toMatch(
      /passed; the scope gate is stuck in a loop \(the loop guard\), so it's with the owner now/
    );
  });

  it("counts a failure once per head, however often and however concurrently that head is judged", async () => {
    const t = setup();
    await reviewNow(t.w);
    // The PR body carries AI attribution, and CI fails too: both judged by
    // sign_off, again when CI finishes, and several times at once.
    S.pr = {
      ...S.pr!,
      checks: "fail",
      failing: "pr-body",
      attribution: ATTRIBUTED,
    };
    await expect(t.signOff()).rejects.toThrow(/code-review failed \(first\)/);
    const again = await Promise.allSettled([
      t.signOff(),
      t.signOff(),
      t.signOff(),
    ]);
    for (const r of again) {
      expect(r.status).toBe("rejected");
      const text = String((r as PromiseRejectedResult).reason);
      expect(text).toMatch(/code-review failed \(first\)/);
      expect(text).toMatch(/ci failed \(first\)/);
    }
    for (const gate of ["code-review", "ci"])
      expect(failureOf(t.task, gate)).toMatchObject({
        count: 1,
        last_sha: t.sha,
        escalated_at: null,
      });
    expect(openAsks(t.w)).toEqual([]);
  });

  it("starts a new streak after a pass, so the same failure either side of it isn't a loop", async () => {
    const t = setup();
    await reviewNow(t.w);
    S.pr = failingCI();
    await expect(t.signOff()).rejects.toThrow(/ci failed \(first\)/);
    // Head B passes CI (the review of B waits, so nothing merges).
    t.push("src/b.ts", "export const b = 2;\n");
    S.pr = { ...S.pr!, checks: "pass", failing: null };
    await expect(t.signOff()).rejects.toThrow(/review: not yet/);
    expect(failureOf(t.task, "ci")).toMatchObject({ count: 1, streak: 0 });
    // Head C fails the same way: the first of a new streak.
    const c = t.push("src/c.ts", "export const c = 3;\n");
    await reviewNow(t.w);
    S.pr = failingCI();
    await expect(t.signOff()).rejects.toThrow(/ci failed \(first\)/);
    expect(failureOf(t.task, "ci")).toMatchObject({
      count: 2,
      streak: 1,
      last_sha: c,
      escalated_at: null,
    });
    expect(openAsks(t.w)).toEqual([]);
  });
});

describe("a merge decision from the owner", () => {
  const ask = (t: ReturnType<typeof setup>, extra: object) =>
    runTool(t.w, "ask_owner", {
      title: "Merge add-a despite the review?",
      detail: "The review blocks on an item the owner dropped.",
      kind: "decision",
      ...extra,
    });

  it("links an ask to the task and commit, and merges it once at that commit on his approval", async () => {
    const t = setup();
    await reviewNow(t.w, "block");
    await expect(
      ask(t, { task: "add-a", sha: t.sha.slice(0, 7) })
    ).resolves.toMatch(/If he approves, sign_off merges it once, at/);
    const [raised] = openAsks(t.w);
    expect(raised).toMatchObject({
      subject: `task:${t.task}`,
      kind: "gate",
      sha: t.sha,
      link: "https://github.com/o/r/pull/7",
    });
    await expect(t.signOff()).rejects.toThrow(/review failed/);
    answerAsk(t.w, raised.id, { action: "approve" }, t.sha);
    await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
    expect(merges).toEqual([
      ["pr", "merge", "7", "--squash", "--match-head-commit", t.sha],
    ]);
    expect(getAsk(t.w, raised.id)?.used_at).toBeTruthy();
    expect(listNotes(t.w).at(-1)?.text).toMatch(/on the owner's approval/);
  });

  it("doesn't merge a later commit on an approval of an earlier one", async () => {
    const t = setup();
    await reviewNow(t.w, "block");
    await ask(t, { task: "add-a", sha: t.sha });
    const [raised] = openAsks(t.w);
    answerAsk(t.w, raised.id, { action: "approve" });
    t.push("src/b.ts", "export const b = 2;\n");
    await expect(t.signOff()).rejects.toThrow(/review: not yet/);
    expect(merges).toEqual([]);
  });

  it("refuses a sha that isn't the PR's head, and a task without a sha", async () => {
    const t = setup();
    const next = t.push("src/b.ts", "export const b = 2;\n");
    await expect(ask(t, { task: "add-a", sha: t.sha })).rejects.toThrow(
      new RegExp(`head is ${next.slice(0, 7)}, not ${t.sha.slice(0, 7)}`)
    );
    await expect(ask(t, { task: "add-a" })).rejects.toThrow(
      /Give both task and sha/
    );
    expect(openAsks(t.w)).toEqual([]);
  });

  it("carries AgentOS's own facts under the orchestrator's words", async () => {
    const t = setup({ approvals: true });
    t.push(".github/workflows/ci.yml", "on: push\n");
    await expect(ask(t, { task: "add-a", sha: S.pr!.head! })).resolves.toMatch(
      /sign_off merges it once/
    );
    const [raised] = openAsks(t.w);
    expect(raised.detail).toMatch(
      /^AgentOS: PR #7 at \w{7} changes 2 files; touches \.github\/workflows\/ci\.yml \(CI config\); review: none yet\n/
    );
    expect(raised.link).toBe("https://github.com/o/r/pull/7");
  });

  it("moves its own merge ask to a new head, and merges that one", async () => {
    const t = setup();
    await reviewNow(t.w, "block");
    await ask(t, { task: "add-a", sha: t.sha });
    expect(openAsks(t.w)[0].detail).toMatch(/; review: block\n/);
    const next = t.push("src/b.ts", "export const b = 2;\n");
    await reviewNow(t.w, "block");
    await expect(ask(t, { task: "add-a", sha: next })).resolves.toMatch(
      /Already on the owner's list as ask \d+; updated it/
    );
    const [raised] = openAsks(t.w);
    expect(raised.sha).toBe(next);
    answerAsk(t.w, raised.id, { action: "approve" }, next);
    await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
    expect(merges).toEqual([
      ["pr", "merge", "7", "--squash", "--match-head-commit", next],
    ]);
  });

  it("keeps AgentOS's facts and the PR's own link whatever the orchestrator writes", async () => {
    const t = setup();
    await ask(t, {
      task: "add-a",
      sha: t.sha,
      detail: "x".repeat(2000),
      link: "https://example.com/elsewhere",
    });
    const [raised] = openAsks(t.w);
    expect(raised.detail).toMatch(/^AgentOS: PR #7 at \w{7} changes 1 file/);
    expect(raised.detail.length).toBe(2000);
    expect(raised.link).toBe("https://github.com/o/r/pull/7");
  });

  it("never rewrites an ask the gates raised", async () => {
    const t = setup({ approvals: true });
    t.push(".github/workflows/ci.yml", "on: push\n");
    await reviewNow(t.w);
    await expect(t.signOff()).rejects.toThrow(/Escalated to the owner/);
    const gate = oneGateAsk(t.w, t.task, S.pr!.head!);
    await expect(
      ask(t, { task: "add-a", sha: S.pr!.head!, title: "Merge a typo fix?" })
    ).resolves.toMatch(/Already on the owner's list as ask \d+; left as it is/);
    expect(getAsk(t.w, gate.id)).toMatchObject({
      title: gate.title,
      detail: gate.detail,
    });
  });

  // An orchestrator's merge ask at the head, approved, with no review run.
  async function approved(t: ReturnType<typeof setup>, sha = t.sha) {
    await ask(t, { task: "add-a", sha });
    const [raised] = openAsks(t.w);
    answerAsk(t.w, raised.id, { action: "approve" }, sha);
    return raised;
  }

  // CI has looked settled on the head for a while.
  const settle = (t: ReturnType<typeof setup>) =>
    putCheck({
      workspaceId: t.w,
      sessionId: t.task,
      sha: S.pr!.head!,
      kind: "ci",
      status: "pass",
      detail: JSON.stringify({ count: S.pr!.checkCount, at: 0 }),
    });

  it("merges the commit the owner approved without a review of it", async () => {
    const t = setup();
    const raised = await approved(t);
    expect(getCheck(t.task, t.sha, "review")).toBeNull();
    await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
    expect(merges).toEqual([
      ["pr", "merge", "7", "--squash", "--match-head-commit", t.sha],
    ]);
    expect(getAsk(t.w, raised.id)?.used_at).toBeTruthy();
    expect(listNotes(t.w).at(-1)?.text).toMatch(/on the owner's approval/);
  });

  it("merges an approved commit whose review blocks", async () => {
    const t = setup();
    await reviewNow(t.w, "block");
    await approved(t);
    await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
  });

  it("merges a held task on an approval at its head, without a review", async () => {
    const t = setup({ approvals: true });
    t.push(".github/workflows/ci.yml", "on: push\n");
    await expect(t.signOff()).rejects.toThrow(/Escalated to the owner/);
    const gate = oneGateAsk(t.w, t.task, S.pr!.head!);
    answerAsk(t.w, gate.id, { action: "approve" }, S.pr!.head!);
    expect(getCheck(t.task, S.pr!.head!, "review")).toBeNull();
    await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
    expect(getAsk(t.w, gate.id)?.used_at).toBeTruthy();
  });

  it("refuses an approval of an older commit", async () => {
    const t = setup();
    const raised = await approved(t);
    t.push("src/b.ts", "export const b = 2;\n");
    await expect(t.signOff()).rejects.toThrow(/review: not yet/);
    expect(merges).toEqual([]);
    expect(getAsk(t.w, raised.id)?.used_at).toBeNull();
  });

  it("still refuses an approved commit whose PR body carries AI attribution", async () => {
    const t = setup();
    const raised = await approved(t);
    S.pr = { ...S.pr!, attribution: ATTRIBUTED };
    await expect(t.signOff()).rejects.toThrow(
      /the owner approved this commit, but the PR body carries AI attribution/
    );
    expect(merges).toEqual([]);
    expect(getAsk(t.w, raised.id)?.used_at).toBeNull();
  });

  it("refuses an approved commit whose CI failed, and waits on CI still running", async () => {
    const t = setup();
    const raised = await approved(t);
    settle(t);
    S.pr = { ...S.pr!, checks: "fail", failing: "test" };
    const failed = await judge(t.w, getTaskSession(t.task)!);
    expect(failed).toMatchObject({ ok: false, wait: false });
    expect(!failed.ok && failed.text).toMatch(
      /the owner approved this commit, but CI failed on/
    );
    S.pr = { ...S.pr!, checks: "pending", failing: null };
    const running = await judge(t.w, getTaskSession(t.task)!);
    expect(running).toMatchObject({ ok: false, wait: true });
    expect(!running.ok && running.text).toMatch(
      /the owner approved this commit, but CI is still running/
    );
    expect(merges).toEqual([]);
    expect(getAsk(t.w, raised.id)?.used_at).toBeNull();
    S.pr = { ...S.pr!, checks: "pass" };
    await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
  });

  it("uses the approval once", async () => {
    const t = setup();
    const raised = await approved(t);
    settle(t);
    const task = getTaskSession(t.task)!;
    const first = await judge(t.w, task);
    const second = await judge(t.w, task);
    expect(first).toMatchObject({ ok: true, approval: raised.id });
    expect(second).toMatchObject({ ok: true, approval: raised.id });
    await mergeJudged(t.w, task, first as Extract<typeof first, { ok: true }>);
    await expect(
      mergeJudged(t.w, task, second as Extract<typeof second, { ok: true }>)
    ).rejects.toThrow(/approval for add-a was already used/);
    expect(merges).toHaveLength(1);
  });

  it("merges an armed held task on the owner's approval of its head", async () => {
    const t = setup({ approvals: true });
    t.push(".github/workflows/ci.yml", "on: push\n");
    await expect(t.signOff()).rejects.toThrow(/Escalated to the owner/);
    const gate = oneGateAsk(t.w, t.task, S.pr!.head!);
    expect(() => armTask(getTaskSession(t.task)!)).toThrow(/is with the owner/);
    answerAsk(t.w, gate.id, { action: "approve" }, S.pr!.head!);
    armTask(getTaskSession(t.task)!);
    settle(t);
    await mergeArmed(t.w, [
      { id: t.task, task: { pr: S.pr } },
    ] as unknown as SessionFacts[]);
    expect(merges).toEqual([
      ["pr", "merge", "7", "--squash", "--match-head-commit", S.pr!.head!],
    ]);
    expect(getAsk(t.w, gate.id)?.used_at).toBeTruthy();
  });

  it("never lets its approval skip the code review of a held task", async () => {
    const t = setup();
    await reviewNow(t.w);
    // The code-review gate fails on its fourth commit in a row and the
    // task is held for the owner.
    failedBefore(t.w, t.task, "code-review");
    S.pr = { ...S.pr!, attribution: ATTRIBUTED };
    await expect(t.signOff()).rejects.toThrow(/Escalated to the owner/);
    await askUp(t.w, t.task);
    const gate = oneGateAsk(t.w, t.task, t.sha);
    // the owner replies rather than approving: the task stays held, and the
    // orchestrator raises its own merge ask.
    answerAsk(t.w, gate.id, { action: "reply", text: "why no review?" });
    await ask(t, { task: "add-a", sha: t.sha });
    const [raised] = openAsks(t.w);
    expect(raised).toMatchObject({ raised_by: "orchestrator", sha: t.sha });
    expect(raised.detail).toMatch(
      /held for you by the gates: code-review \(the PR body carries AI attribution/
    );
    answerAsk(t.w, raised.id, { action: "approve" }, t.sha);
    await expect(t.signOff()).rejects.toThrow(
      /the owner approved this commit, but the PR body carries AI attribution/
    );
    expect(merges).toEqual([]);
    expect(getAsk(t.w, raised.id)?.used_at).toBeNull();
    // With the attribution gone, that approval merges it once.
    S.pr = { ...S.pr!, attribution: null };
    await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
    expect(getAsk(t.w, raised.id)?.used_at).toBeTruthy();
  });

  async function heldTask() {
    const t = setup();
    await reviewNow(t.w);
    failedBefore(t.w, t.task, "code-review");
    S.pr = { ...S.pr!, attribution: ATTRIBUTED };
    await expect(t.signOff()).rejects.toThrow(/Escalated to the owner/);
    await askUp(t.w, t.task);
    answerAsk(t.w, oneGateAsk(t.w, t.task, t.sha).id, {
      action: "reply",
      text: "fix it",
    });
    S.pr = { ...S.pr!, attribution: null };
    return t;
  }
  const WITH_SAAD =
    /is with the owner \(code-review\); no review needed from you/;

  it("reviews the approved head of a held task, counts nothing, and merges once", async () => {
    const t = await heldTask();
    const next = t.push("src/b.ts", "export const b = 1;\n");
    await expect(reviewNow(t.w)).resolves.toMatchObject({
      text: expect.stringMatching(WITH_SAAD),
    });
    await ask(t, { task: "add-a", sha: next });
    const [raised] = openAsks(t.w);
    // An open ask of the orchestrator's at the head is enough to review it.
    const failures = failureOf(t.task, "review");
    const codeReview = failureOf(t.task, "code-review");
    const blocked = await reviewNow(t.w, "block");
    expect(blocked.text).toMatch(/blocking findings/);
    expect(failureOf(t.task, "review")).toEqual(failures);
    expect(failureOf(t.task, "code-review")).toEqual(codeReview);
    expect(openAsks(t.w).map((a) => a.id)).toEqual([raised.id]);
    answerAsk(t.w, raised.id, { action: "approve" }, next);
    await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
    expect(merges).toHaveLength(1);
    expect(getAsk(t.w, raised.id)?.used_at).toBeTruthy();
  });

  it("still refuses to review a held task whose approval is for an older commit", async () => {
    const t = await heldTask();
    await ask(t, { task: "add-a", sha: t.sha });
    const [raised] = openAsks(t.w);
    answerAsk(t.w, raised.id, { action: "approve" }, t.sha);
    t.push("src/b.ts", "export const b = 1;\n");
    const r = await reviewNow(t.w);
    expect(r.text).toMatch(WITH_SAAD);
    expect(r.runs).toEqual([]);
  });

  it("still refuses to review a held task with no ask at its head", async () => {
    const t = await heldTask();
    t.push("src/b.ts", "export const b = 1;\n");
    const r = await reviewNow(t.w);
    expect(r.text).toMatch(WITH_SAAD);
    expect(r.runs).toEqual([]);
  });

  it("keeps its ask the orchestrator's when the gates escalate onto it", async () => {
    const t = setup();
    await reviewNow(t.w);
    await ask(t, { task: "add-a", sha: t.sha });
    const [raised] = openAsks(t.w);
    // The code-review gate then fails on its fourth commit in a row and
    // escalates onto that ask.
    failedBefore(t.w, t.task, "code-review");
    S.pr = { ...S.pr!, attribution: ATTRIBUTED };
    await expect(t.signOff()).rejects.toThrow(/Escalated to the owner/);
    expect(openAsks(t.w)).toMatchObject([
      { id: raised.id, raised_by: "orchestrator", sha: t.sha },
    ]);
    answerAsk(t.w, raised.id, { action: "approve" }, t.sha);
    await expect(t.signOff()).rejects.toThrow(
      /the owner approved this commit, but the PR body carries AI attribution/
    );
    expect(merges).toEqual([]);
    S.pr = { ...S.pr!, attribution: null };
    await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
  });

  it("keeps a plain decision ask off the task, so its approval merges nothing", async () => {
    const t = setup();
    await reviewNow(t.w, "block");
    await ask(t, {});
    const [raised] = openAsks(t.w);
    expect(raised).toMatchObject({ kind: "decision", sha: null });
    answerAsk(t.w, raised.id, { action: "approve" });
    await expect(t.signOff()).rejects.toThrow(/review failed/);
    expect(merges).toEqual([]);
  });
});

describe("a PR the loop guard sent to the owner", () => {
  // CI failing the same way on two commits, then a fix whose CI passes:
  // the owner's ask names the fix.
  async function stuck() {
    const t = setup();
    await reviewNow(t.w);
    S.pr = failingCI();
    await expect(t.signOff()).rejects.toThrow(/ci failed \(first\)/);
    t.push("src/b.ts", "export const b = 2;\n");
    await expect(t.signOff()).rejects.toThrow(
      /Escalated to the owner: the ci gate failed the same way on two commits in a row/
    );
    const fix = t.push("src/c.ts", "export const c = 3;\n");
    S.pr = { ...S.pr!, checks: "pass", failing: null, failingUrl: null };
    await askUp(t.w, t.task);
    return { t, fix, ask: oneGateAsk(t.w, t.task, fix) };
  }
  const judgeAsked = (w: string, task: string, verdict: "pass" | "block") => {
    const reviews: string[] = [];
    return followAskVerdicts(w, taskFacts(task), {
      review: async (ws, ref) => {
        reviews.push(ref);
        await review(ws, ref, { wait: true, claude: reviewer(verdict).claude });
      },
    }).then(() => reviews);
  };

  it("still reviews the commit the owner would approve, and his ask shows CI and that review", async () => {
    const { t, fix, ask } = await stuck();
    expect(ask.detail).toMatch(/^the ci gate failed the same way/);
    expect(await judgeAsked(t.w, t.task, "block")).toEqual([t.task]);
    expect(getCheck(t.task, fix, "review")?.status).toBe("block");
    const shown = getAsk(t.w, ask.id)!.detail;
    expect(shown).toMatch(/^the ci gate failed the same way/);
    expect(shown).toMatch(
      new RegExp(
        `Gates at ${fix.slice(0, 7)}: CI passed\\. Independent review: blocking findings\\.[\\s\\S]*src/a\\.ts:1: off by one`
      )
    );
    // Reviewed once: the next pass only refreshes what the ask shows.
    expect(await judgeAsked(t.w, t.task, "block")).toEqual([]);
    expect(getAsk(t.w, ask.id)!.detail).toBe(shown);
    // Counted nothing: the task is with the owner.
    expect(failureOf(t.task, "review")).toBeNull();
  });

  it("merges once at the commit the owner approves, whatever the review said", async () => {
    const { t, fix, ask } = await stuck();
    await judgeAsked(t.w, t.task, "block");
    answerAsk(t.w, ask.id, { action: "approve" }, fix);
    await expect(t.signOff()).resolves.toMatch(/Merged add-a/);
    expect(merges).toEqual([
      ["pr", "merge", "7", "--squash", "--match-head-commit", fix],
    ]);
    expect(getAsk(t.w, ask.id)?.used_at).toBeTruthy();
  });

  it("asks him again, with a fresh review, when the head moves past the commit he approved", async () => {
    const { t, fix, ask } = await stuck();
    answerAsk(t.w, ask.id, { action: "approve" }, fix);
    const later = t.push("src/d.ts", "export const d = 4;\n");
    await expect(t.signOff()).rejects.toThrow(
      /The owner approved \w+, but PR #7's head is now/
    );
    expect(merges).toEqual([]);
    const again = oneGateAsk(t.w, t.task, later);
    await judgeAsked(t.w, t.task, "pass");
    expect(getAsk(t.w, again.id)!.detail).toMatch(
      new RegExp(
        `Gates at ${later.slice(0, 7)}: CI passed\\. Independent review: passed\\.`
      )
    );
  });
});
