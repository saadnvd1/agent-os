import fs from "fs";
import os from "os";
import path from "path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PRState } from "./ask-settle";

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
const { ensureOrchestrator } = await import("./home");
const { runTool } = await import("./serve");
const { listNotes } = await import("./notes");
const { escalate } = await import("./escalate");
const { orchestratorOverview } = await import("./overview");
const { seedWorkspace } = await import("./testing");
const { openAsks, raiseAsk, BRAKE_SUBJECT } = await import("./asks");
const {
  forgetPRStates,
  parsePRView,
  prKey,
  refreshAskPRs,
  resolveMergedTaskAsks,
  resolveStaleAsks,
  settleStaleAsks,
} = await import("./ask-settle");

type Session = import("@/lib/db").Session;
const getSession = (id: string) =>
  db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Session;

beforeAll(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aos-orch-settle-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});
beforeEach(() => forgetPRStates());

const PR = "https://github.com/saadnvd1/agent-os/pull/107";

function workspace() {
  const ws = seedWorkspace();
  ensureOrchestrator(ws.workspace.id);
  const w = ws.workspace.id;
  const setTask = (fields: Record<string, string | number | null>) => {
    const cols = Object.keys(fields);
    db.prepare(
      `UPDATE sessions SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`
    ).run(...cols.map((c) => fields[c]), ws.task);
  };
  // The task has PR #107 open, as prFor records it.
  setTask({ pr_url: PR, pr_number: 107, pr_status: "open" });
  const ask = (title: string, link?: string) =>
    runTool(w, "ask_saad", {
      title,
      detail: `Why: ${title}`,
      kind: "decision",
      ...(link && { link }),
    });
  return { w, task: ws.task, setTask, ask };
}

// A GitHub that answers from a table, counting what it was asked.
function github(states: Record<string, PRState | Error>) {
  const asked: string[] = [];
  const view = async (key: string) => {
    asked.push(key);
    const s = states[key];
    if (!s) throw new Error(`no PR ${key}`);
    if (s instanceof Error) throw s;
    return s;
  };
  return { view, asked };
}

describe("prKey", () => {
  it("names a PR however its link is written", () => {
    expect(prKey(PR)).toBe("saadnvd1/agent-os#107");
    expect(prKey(`${PR}/files`)).toBe("saadnvd1/agent-os#107");
    expect(prKey(` ${PR.toUpperCase().replace("HTTPS", "https")}#x `)).toBe(
      "saadnvd1/agent-os#107"
    );
    expect(prKey("https://github.com/o/r/pull/107x")).toBeNull();
    expect(prKey("https://example.com/o/r/pull/1")).toBeNull();
    expect(prKey(null)).toBeNull();
  });
});

describe("parsePRView", () => {
  it("reads gh's answer for merged, closed and open PRs", () => {
    const oid = "da11b59".padEnd(40, "0");
    expect(
      parsePRView(JSON.stringify({ state: "MERGED", mergeCommit: { oid } }))
    ).toEqual({ state: "MERGED", mergeSha: oid });
    expect(
      parsePRView(JSON.stringify({ state: "CLOSED", mergeCommit: null }))
    ).toEqual({ state: "CLOSED", mergeSha: null });
    expect(parsePRView(JSON.stringify({ state: "OPEN" }))).toEqual({
      state: "OPEN",
      mergeSha: null,
    });
  });

  it("throws on anything else, so the ask stays open", () => {
    expect(() => parsePRView(JSON.stringify({ state: "merged" }))).toThrow(
      /unknown state/
    );
    expect(() => parsePRView("not json")).toThrow();
    expect(
      parsePRView(
        JSON.stringify({ state: "MERGED", mergeCommit: { oid: "-rf; x" } })
      ).mergeSha
    ).toBeNull();
  });
});

describe("asks about work that finished elsewhere", () => {
  it("closes an ask linking a PR once its task merged, and says so", async () => {
    const t = workspace();
    await t.ask("Re-approve PR #107 (composer) at e5afa42?", PR);
    expect(resolveStaleAsks(t.w)).toBe(0);
    t.setTask({ task_status: "merged", pr_status: "merged" });
    expect(resolveStaleAsks(t.w)).toBe(1);
    expect(openAsks(t.w)).toEqual([]);
    const row = db
      .prepare(
        `SELECT status, answer FROM orchestrator_asks WHERE workspace_id = ?`
      )
      .get(t.w);
    expect(row).toEqual({
      status: "resolved",
      answer: "PR #107 merged elsewhere",
    });
    expect(listNotes(t.w).at(-1)?.text).toBe(
      'Closed ask "Re-approve PR #107 (composer) at e5afa42?": PR #107 merged elsewhere.'
    );
  });

  it("closes it when the PR was merged on GitHub, naming the merge commit", async () => {
    const t = workspace();
    // The task's PR merged outside AgentOS; the task still reads running.
    t.setTask({ pr_status: "merged" });
    await t.ask("Re-approve PR #107?", PR);
    const gh = github({
      "saadnvd1/agent-os#107": {
        state: "MERGED",
        mergeSha: "da11b59" + "0".repeat(33),
      },
    });
    expect(await settleStaleAsks(t.w, gh.view)).toBe(1);
    const [row] = db
      .prepare(`SELECT answer FROM orchestrator_asks WHERE workspace_id = ?`)
      .all(t.w) as { answer: string }[];
    expect(row.answer).toBe("PR #107 merged as da11b59 elsewhere");
  });

  it("asks GitHub about a PR no task tracks, and closes on merged or closed", async () => {
    const t = workspace();
    await t.ask("Merge the docs PR?", "https://github.com/o/docs/pull/3");
    await t.ask("Merge the site PR?", "https://github.com/o/site/pull/4");
    await t.ask("Merge the api PR?", "https://github.com/o/api/pull/5");
    const gh = github({
      "o/docs#3": { state: "MERGED", mergeSha: "abcdef0123" },
      "o/site#4": { state: "CLOSED", mergeSha: null },
      "o/api#5": { state: "OPEN", mergeSha: null },
    });
    expect(await settleStaleAsks(t.w, gh.view)).toBe(2);
    expect(openAsks(t.w).map((a) => a.title)).toEqual(["Merge the api PR?"]);
    const answers = (
      db
        .prepare(
          `SELECT title, answer FROM orchestrator_asks WHERE workspace_id = ? AND status = 'resolved' ORDER BY id`
        )
        .all(t.w) as { title: string; answer: string }[]
    ).map((r) => r.answer);
    expect(answers).toEqual([
      "PR #3 merged as abcdef0 elsewhere",
      "PR #4 was closed without merging",
    ]);

    // An open PR is looked up again only after a minute.
    gh.asked.length = 0;
    await settleStaleAsks(t.w, gh.view);
    expect(gh.asked).toEqual([]);
    const later = github({ "o/api#5": { state: "MERGED", mergeSha: null } });
    await refreshAskPRs(t.w, later.view, Date.now() + 61 * 1000);
    expect(later.asked).toEqual(["o/api#5"]);
    expect(resolveStaleAsks(t.w)).toBe(1);
    expect(openAsks(t.w)).toEqual([]);
  });

  it("doesn't trust an old \"closed\" once the task's PR is open again", async () => {
    const t = workspace();
    t.setTask({ pr_status: "closed" });
    await t.ask("Reopen PR #107?", PR);
    const gh = github({
      "saadnvd1/agent-os#107": { state: "CLOSED", mergeSha: null },
    });
    expect(await settleStaleAsks(t.w, gh.view)).toBe(1);
    // Reopened: the task tracks it as open, so GitHub's last word is stale.
    t.setTask({ pr_status: "open" });
    await t.ask("Re-approve PR #107?", PR);
    expect(resolveStaleAsks(t.w)).toBe(0);
    expect(openAsks(t.w).map((a) => a.title)).toEqual(["Re-approve PR #107?"]);
  });

  it("looks up a closed PR again, since it can be reopened", async () => {
    const t = workspace();
    const link = "https://github.com/o/x/pull/9";
    await t.ask("Merge the x PR?", link);
    await settleStaleAsks(
      t.w,
      github({ "o/x#9": { state: "CLOSED", mergeSha: null } }).view
    );
    await t.ask("Merge the x PR now?", link);
    const reopened = github({ "o/x#9": { state: "OPEN", mergeSha: null } });
    await refreshAskPRs(t.w, reopened.view, Date.now() + 61 * 1000);
    expect(reopened.asked).toEqual(["o/x#9"]);
    expect(resolveStaleAsks(t.w)).toBe(0);
    expect(openAsks(t.w).map((a) => a.title)).toEqual(["Merge the x PR now?"]);
  });

  it("logs a failure to close an ask instead of throwing it", async () => {
    const t = workspace();
    await t.ask("Re-approve PR #107?", PR);
    t.setTask({ task_status: "merged", pr_status: "merged" });
    const trigger = `no_close_${t.w.replace(/\W/g, "")}`;
    db.exec(
      `CREATE TRIGGER ${trigger} BEFORE UPDATE ON orchestrator_asks
       WHEN NEW.workspace_id = '${t.w}' BEGIN SELECT RAISE(ABORT, 'boom'); END`
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(resolveStaleAsks(t.w)).toBe(0);
      expect(resolveMergedTaskAsks(t.task, PR, "merged")).toBe(0);
      expect(String(logged.mock.calls[0]?.[0])).toMatch(/closing stale asks/);
      expect(openAsks(t.w)).toHaveLength(1);
    } finally {
      logged.mockRestore();
      db.exec(`DROP TRIGGER ${trigger}`);
    }
  });

  it("leaves an ask open when GitHub can't say", async () => {
    const t = workspace();
    await t.ask("Merge the docs PR?", "https://github.com/o/docs/pull/3");
    const gh = github({ "o/docs#3": new Error("gh: rate limited") });
    expect(await settleStaleAsks(t.w, gh.view)).toBe(0);
    expect(openAsks(t.w)).toHaveLength(1);
  });

  it("doesn't ask GitHub about a running task's open PR, or close its asks", async () => {
    const t = workspace();
    await t.ask("Re-approve PR #107?", PR);
    escalate(t.w, getSession(t.task), "ci", "no CI", PR, "c".repeat(40));
    const gh = github({});
    expect(await settleStaleAsks(t.w, gh.view)).toBe(0);
    expect(gh.asked).toEqual([]);
    expect(openAsks(t.w)).toHaveLength(2);
  });

  it("closes a task's gate ask when the task is merged, dropped, done or gone", () => {
    for (const [fields, why] of [
      [{ task_status: "merged" }, "PR #107 merged elsewhere"],
      [{ task_status: "dropped", pr_status: "closed" }, "the task was dropped"],
      [{ task_status: "done" }, "the task was done"],
      [{ pr_status: "closed" }, "PR #107 was closed without merging"],
    ] as const) {
      const t = workspace();
      escalate(t.w, getSession(t.task), "ci", "no CI", PR, "c".repeat(40));
      t.setTask(fields);
      expect(resolveStaleAsks(t.w)).toBe(1);
      const row = db
        .prepare(`SELECT answer FROM orchestrator_asks WHERE workspace_id = ?`)
        .get(t.w);
      expect(row).toEqual({ answer: why });
    }
    const t = workspace();
    escalate(t.w, getSession(t.task), "ci", "no CI", PR, "c".repeat(40));
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(t.task);
    expect(resolveStaleAsks(t.w)).toBe(1);
    expect(
      db
        .prepare(`SELECT answer FROM orchestrator_asks WHERE workspace_id = ?`)
        .get(t.w)
    ).toEqual({ answer: "the task is gone" });
  });

  it("leaves asks about anything else alone", async () => {
    const t = workspace();
    t.setTask({ task_status: "merged", pr_status: "merged" });
    await t.ask("Buy the domain?");
    await t.ask("Read this doc?", "https://example.com/pull/107");
    raiseAsk({
      workspaceId: t.w,
      subject: BRAKE_SUBJECT,
      kind: "brake",
      title: "Start past the brakes?",
      link: PR,
    });
    expect(await settleStaleAsks(t.w, github({}).view)).toBe(0);
    expect(openAsks(t.w).map((a) => a.title)).toEqual([
      "Buy the domain?",
      "Read this doc?",
      "Start past the brakes?",
    ]);
  });
});

describe("where stale asks are noticed", () => {
  it("the overview Saad reads never shows one", async () => {
    const t = workspace();
    await t.ask("Re-approve PR #107?", PR);
    t.setTask({ task_status: "merged", pr_status: "merged" });
    const mine = orchestratorOverview().find((o) => o.workspaceId === t.w);
    expect(mine?.asks).toEqual([]);
  });

  it("the orchestrator's sessions tool closes them", async () => {
    const t = workspace();
    await t.ask("Re-approve PR #107?", PR);
    t.setTask({ task_status: "merged", pr_status: "merged" });
    await runTool(t.w, "sessions", {});
    expect(openAsks(t.w)).toEqual([]);
  });

  it("a sign-off closes the task's asks and any ask linking its PR, only those", async () => {
    const t = workspace();
    escalate(t.w, getSession(t.task), "ci", "no CI", PR, "c".repeat(40));
    await t.ask("Re-approve PR #107?", `${PR}/files`);
    await t.ask(
      "Merge PR #108?",
      "https://github.com/saadnvd1/agent-os/pull/108"
    );
    expect(
      resolveMergedTaskAsks(t.task, PR, "PR #107 merged at e5afa42 by sign-off")
    ).toBe(2);
    expect(openAsks(t.w).map((a) => a.title)).toEqual(["Merge PR #108?"]);
  });
});
