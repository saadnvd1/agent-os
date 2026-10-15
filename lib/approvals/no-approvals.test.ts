import fs from "fs";
import os from "os";
import path from "path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/status-detector", () => ({
  checkWaitingPatterns: () => false,
  statusDetector: {
    refreshCache: async () => {},
    sessionExists: () => true,
    getStatus: async () => "idle",
    titleFor: () => "",
    getTimestamp: () => 0,
    hostFor: () => "local",
    capturePane: async () => "",
  },
}));

const { db } = await import("@/lib/db");
const { ensureOrchestrator } = await import("@/lib/orchestrator/home");
const { runTool } = await import("@/lib/orchestrator/serve");
const { seedWorkspace } = await import("@/lib/orchestrator/testing");
const { escalate } = await import("@/lib/orchestrator/escalate");
const { latestApproval } = await import("@/lib/orchestrator/ask-approvals");
const { listNotes } = await import("@/lib/orchestrator/notes");
const {
  answerAsk,
  getAsk,
  openAsks,
  raiseAsk,
  workSubject,
  HARD_LINES,
  AskRefused,
} = await import("@/lib/orchestrator/asks");
const { mergeApprovalsOn, mergeApprovalsSetting, setMergeApprovals } =
  await import("@/lib/orchestrator/merge-approvals");
const { holdingEscalations, markEscalated, recordFailure } =
  await import("@/lib/orchestrator/gates");
const {
  AUTO_LABEL,
  effectiveAutoApprove,
  effectiveChatAccess,
  listAutoApprovals,
  noApprovalsOn,
  recordAutoApproval,
  recordAutoApprovalOnce,
  setNoApprovals,
} = await import("./no-approvals");
const { switchNoApprovals } = await import("./enable");
const hookRoute = await import("@/app/api/approvals/hook/route");

beforeAll(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aos-no-approvals-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});
beforeEach(() => {
  setNoApprovals(false);
  setMergeApprovals(false);
  db.exec(`DELETE FROM approval_audit`);
});

function workspace() {
  const ws = seedWorkspace();
  ensureOrchestrator(ws.workspace.id);
  const w = ws.workspace.id;
  const ask = (title: string, kind: string) =>
    runTool(w, "ask_saad", { title, detail: `Why: ${title}`, kind });
  return { ...ws, w, ask };
}

describe("the setting", () => {
  it("is off by default and survives being set both ways", () => {
    expect(noApprovalsOn()).toBe(false);
    setNoApprovals(true);
    expect(noApprovalsOn()).toBe(true);
    setNoApprovals(false);
    expect(noApprovalsOn()).toBe(false);
  });

  it("forces full chat access and the terminal skip flag, without touching what was stored", () => {
    for (const stored of ["ask", "edits", "full"] as const)
      expect(effectiveChatAccess(stored)).toBe(stored);
    expect(effectiveAutoApprove(0)).toBe(false);
    expect(effectiveAutoApprove(1)).toBe(true);
    setNoApprovals(true);
    for (const stored of ["ask", "edits", "full"] as const)
      expect(effectiveChatAccess(stored)).toBe("full");
    expect(effectiveAutoApprove(0)).toBe(true);
  });

  it("records an approval with a note in the workspace, and once per subject when asked", () => {
    const t = workspace();
    recordAutoApproval({
      source: "brake",
      workspaceId: t.w,
      subject: "a start",
      detail: "why",
    });
    expect(listAutoApprovals()[0]).toMatchObject({
      source: "brake",
      subject: "a start",
      detail: "why",
      workspace_id: t.w,
    });
    expect(listNotes(t.w).at(-1)?.text).toMatch(
      /^Auto-approved by No approvals/
    );
    recordAutoApprovalOnce({ source: "plan", subject: "same" });
    recordAutoApprovalOnce({ source: "plan", subject: "same" });
    expect(
      listAutoApprovals(50).filter((a) => a.subject === "same")
    ).toHaveLength(1);
  });
});

describe("asks", () => {
  it("wait for Saad when the mode is off", async () => {
    const t = workspace();
    await t.ask("Pay for the domain?", "money");
    expect(openAsks(t.w)).toHaveLength(1);
    expect(listAutoApprovals()).toHaveLength(0);
  });

  it("are approved as they're raised, every kind, with an event and an audit line", async () => {
    const t = workspace();
    setNoApprovals(true);
    const kinds = ["decision", ...HARD_LINES];
    for (const kind of kinds) await t.ask(`The ${kind} thing?`, kind);
    expect(openAsks(t.w)).toHaveLength(0);
    const events = db
      .prepare(
        `SELECT line FROM orchestrator_events WHERE workspace_id = ? AND key LIKE 'once:ask:%'`
      )
      .all(t.w) as { line: string }[];
    expect(events).toHaveLength(kinds.length);
    for (const e of events) {
      expect(e.line).toContain(`(${AUTO_LABEL})`);
    }
    const audit = listAutoApprovals(50).filter((a) => a.source === "ask");
    expect(audit).toHaveLength(kinds.length);
    for (const a of audit) expect(a.workspace_id).toBe(t.w);
  });

  it("approves a gate escalation at its commit, so sign_off can merge it once", () => {
    const t = workspace();
    const task = db
      .prepare(`SELECT * FROM session_rows WHERE id = ?`)
      .get(t.task) as import("@/lib/db").Session;
    const sha = "b".repeat(40);
    setNoApprovals(true);
    escalate(t.w, task, "review", "blocked twice", "https://pr/9", sha);
    expect(openAsks(t.w)).toHaveLength(0);
    expect(latestApproval(t.w, workSubject(task.id))).toMatchObject({
      status: "approved",
      sha,
    });
  });

  it("approves a passkey ask as seen, and sweeps what was open when it's turned on", async () => {
    const t = workspace();
    const { ask } = raiseAsk({
      workspaceId: t.w,
      subject: "title:old",
      kind: "money",
      title: "Old question?",
      detail: "",
    });
    expect(getAsk(t.w, ask.id)?.status).toBe("open");
    await switchNoApprovals(true);
    expect(noApprovalsOn()).toBe(true);
    expect(getAsk(t.w, ask.id)?.status).toBe("approved");
    expect(listAutoApprovals(50).map((a) => a.source)).toEqual(
      expect.arrayContaining(["ask", "mode"])
    );
    expect(listNotes(t.w).map((n) => n.text)).toEqual(
      expect.arrayContaining([expect.stringMatching(/No approvals mode is on/)])
    );
    await switchNoApprovals(false);
    expect(noApprovalsOn()).toBe(false);
  });

  it("keeps a decline Saad already gave: the cooldown still refuses", () => {
    const t = workspace();
    const { ask } = raiseAsk({
      workspaceId: t.w,
      subject: "title:declined",
      kind: "money",
      title: "Spend it?",
      detail: "",
    });
    answerAsk(t.w, ask.id, { action: "decline" });
    setNoApprovals(true);
    expect(() =>
      raiseAsk({
        workspaceId: t.w,
        subject: "title:declined",
        kind: "money",
        title: "Spend it?",
        detail: "",
      })
    ).toThrow(AskRefused);
  });
});

describe("merge approvals", () => {
  it("read as off in the mode, keeping what Saad set", () => {
    setMergeApprovals(true);
    expect(mergeApprovalsOn()).toBe(true);
    setNoApprovals(true);
    expect(mergeApprovalsOn()).toBe(false);
    expect(mergeApprovalsSetting()).toBe(true);
    setNoApprovals(false);
    expect(mergeApprovalsOn()).toBe(true);
  });

  it("lets go of a task held for sensitive files, as switching them off does", () => {
    const t = workspace();
    setMergeApprovals(true);
    recordFailure(t.w, t.task, "sensitive", "touches CI", "c".repeat(40));
    markEscalated(t.task, "sensitive");
    expect(holdingEscalations(t.task)).toHaveLength(1);
    setNoApprovals(true);
    expect(holdingEscalations(t.task)).toHaveLength(0);
  });
});

describe("the terminal hook", () => {
  const post = (tool: string) =>
    hookRoute.POST(
      new NextRequest("http://localhost:3011/api/approvals/hook?session=s1", {
        method: "POST",
        body: JSON.stringify({ tool_name: tool }),
      })
    );

  it("says nothing when the mode is off", async () => {
    expect(await (await post("Bash")).text()).toBe("");
  });

  it("answers allow in the mode, records it, and never answers a question", async () => {
    setNoApprovals(true);
    const out = JSON.parse(await (await post("Bash")).text());
    expect(out.hookSpecificOutput).toEqual({
      hookEventName: "PermissionRequest",
      decision: { behavior: "allow" },
    });
    expect(listAutoApprovals()[0]).toMatchObject({
      source: "terminal",
      session_id: "s1",
    });
    expect(await (await post("AskUserQuestion")).text()).toBe("");
  });
});
