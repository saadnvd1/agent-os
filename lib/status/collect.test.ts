import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import {
  applyProgramReport,
  programSummary,
  reloadProgramStatus,
} from "@/lib/program-status/store";
import type { ScreenNeed } from "@/lib/status-detector";
import {
  collectStatuses,
  questionDismissed,
  terminalsChanged,
} from "./collect";

const SID = "0b5f4c1e-1111-4222-8333-944445555666";
const NAME = `claude-${SID}`;
let fg = "claude";
const screen = vi.fn(async (): Promise<string> => "running");
const screenNeed = vi.fn(
  (_name: string, _screen: string, _opts: object): ScreenNeed | null => null
);
let pane = "";
const unsentDue = vi.fn(() => false);
const captured = vi.fn((_name: string, _fresh: boolean) => {});
const clearUnsent = vi.fn((_name: string) => {});
const fixture = (name: string) =>
  readFileSync(join(__dirname, "..", "__fixtures__", "screens", name), "utf-8");

vi.mock("@/lib/status-detector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/status-detector")>()),
  statusDetector: {
    captureScreen: async (name: string, fresh = false) => {
      captured(name, fresh);
      return pane;
    },
    screenNeed: (name: string, s: string, opts: object) =>
      screenNeed(name, s, opts),
    unsentDue: () => unsentDue(),
    clearUnsent: (name: string) => clearUnsent(name),
    signature: () => "same",
    refreshCache: async () => {},
    listSessions: async () => [{ name: NAME, hostId: "local" }],
    cleanup: () => {},
    hostErrors: () => ({}),
    getStatus: () => screen(),
    titleFor: () => "",
    hostFor: () => "local",
    foregroundFor: () => fg,
    listedAt: () => Date.now() + 1000,
  },
}));
vi.mock("@/lib/hosts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hosts")>()),
  hostExecFile: async () => ({ stdout: "", stderr: "" }),
}));

beforeEach(() => {
  fg = "claude";
  pane = "";
  screen.mockClear();
  screen.mockResolvedValue("running");
  screenNeed.mockReset();
  clearUnsent.mockClear();
  unsentDue.mockReturnValue(false);
  screenNeed.mockReturnValue(null);
  const db = getDb();
  db.prepare(`DELETE FROM program_status`).run();
  reloadProgramStatus();
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(SID);
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, updated_at, last_seen_at)
     VALUES (?, 'osc', ?, '/tmp', '2026-01-01 00:00:00', '2026-01-01 00:00:00')`
  ).run(SID, NAME);
});

describe("collectStatuses", () => {
  it("reads the screen for a terminal that never reported", async () => {
    const { statuses } = await collectStatuses();
    expect(statuses[SID].status).toBe("running");
    expect(screen).toHaveBeenCalled();
  });

  it("uses a program's report ahead of the screen", async () => {
    applyProgramReport(
      NAME,
      { state: "blocked", id: "", kind: "permission", msg: "Apply 3 changes?" },
      "claude"
    );
    const { statuses } = await collectStatuses();
    expect(statuses[SID]).toMatchObject({
      status: "waiting",
      need: "approve",
      detail: "Apply 3 changes?",
    });
    expect(screen).not.toHaveBeenCalled();
    // A reported question is checked against the live screen, never a kept one.
    expect(captured).toHaveBeenLastCalledWith(NAME, true);
    applyProgramReport(NAME, { state: "working", id: "" }, "claude");
    await collectStatuses();
    expect(captured).toHaveBeenLastCalledWith(NAME, false);
  });

  it("marks done unread, and moves the session's updated_at", async () => {
    applyProgramReport(NAME, { state: "done", id: "" });
    const row = getDb()
      .prepare(`SELECT updated_at FROM sessions WHERE id = ?`)
      .get(SID) as { updated_at: string };
    expect(row.updated_at > "2026-01-01 00:00:00").toBe(true);
    const { statuses } = await collectStatuses();
    expect(statuses[SID]).toMatchObject({ status: "idle", unread: true });
  });

  it("drops working once its program has gone, back to the screen", async () => {
    applyProgramReport(NAME, { state: "working", id: "" }, "claude");
    fg = "zsh";
    const { statuses } = await collectStatuses();
    expect(programSummary(NAME)).toBeNull();
    expect(statuses[SID].status).toBe("running");
    expect(screen).toHaveBeenCalled();
  });

  it("keeps reports across a restart (they're in the database)", async () => {
    applyProgramReport(NAME, { state: "error", id: "", msg: "exit 1" });
    reloadProgramStatus();
    expect(programSummary(NAME)).toMatchObject({
      state: "error",
      msg: "exit 1",
    });
    const { statuses } = await collectStatuses();
    expect(statuses[SID]).toMatchObject({ status: "error", need: "failed" });
  });

  it("writes nothing for a report repeated as is, and everything for a change", () => {
    const db = getDb();
    const row = () =>
      db
        .prepare(
          `SELECT s.updated_at AS touched, p.records
             FROM sessions s LEFT JOIN program_status p ON p.session_name = ?
            WHERE s.id = ?`
        )
        .get(NAME, SID) as { touched: string; records: string };
    expect(applyProgramReport(NAME, { state: "working", id: "" })).toBe(true);
    db.prepare(
      `UPDATE sessions SET updated_at = '2026-01-02 00:00:00' WHERE id = ?`
    ).run(SID);
    const before = row();
    expect(applyProgramReport(NAME, { state: "working", id: "" })).toBe(false);
    expect(row()).toEqual(before);

    expect(
      applyProgramReport(NAME, { state: "blocked", id: "", msg: "a" })
    ).toBe(true);
    expect(
      applyProgramReport(NAME, { state: "blocked", id: "", msg: "b" })
    ).toBe(true);
    expect(programSummary(NAME)?.msg).toBe("b");
    reloadProgramStatus();
    expect(programSummary(NAME)?.msg).toBe("b");
  });

  it("starts a row it can't read over, empty", () => {
    getDb()
      .prepare(
        `INSERT INTO program_status (session_name, records) VALUES (?, ?)`
      )
      .run(NAME, "{not json");
    reloadProgramStatus();
    expect(programSummary(NAME)).toBeNull();
  });

  it("shows a question on screen as Answer, and moves updated_at once", async () => {
    screen.mockResolvedValue("idle");
    screenNeed.mockReturnValue({ need: "answer", detail: "Which one?" });
    const { statuses } = await collectStatuses();
    expect(statuses[SID]).toMatchObject({
      status: "waiting",
      need: "answer",
      detail: "Which one?",
      unread: false,
    });
    expect(screenNeed.mock.calls[0][2]).toEqual({
      question: true,
      hostId: "local",
    });
    const touched = () =>
      (
        getDb()
          .prepare(`SELECT updated_at FROM sessions WHERE id = ?`)
          .get(SID) as { updated_at: string }
      ).updated_at;
    expect(touched() > "2026-01-01 00:00:00").toBe(true);
    getDb()
      .prepare(
        `UPDATE sessions SET updated_at = '2026-01-02 00:00:00' WHERE id = ?`
      )
      .run(SID);
    await collectStatuses();
    expect(touched()).toBe("2026-01-02 00:00:00");
  });

  it("shows unsent text on a session whose program is done, not on one working", async () => {
    applyProgramReport(NAME, { state: "done", id: "", app: "claude-code" });
    screenNeed.mockReturnValue({ need: "unsent", detail: "fix the test" });
    const { statuses } = await collectStatuses();
    expect(statuses[SID]).toMatchObject({
      status: "waiting",
      need: "unsent",
      detail: "fix the test",
    });
    // Its own questions come as reports, not from the screen.
    expect(screenNeed.mock.calls[0][2]).toEqual({
      question: false,
      hostId: "local",
    });

    screenNeed.mockClear();
    applyProgramReport(NAME, { state: "working", id: "" }, "claude");
    expect((await collectStatuses()).statuses[SID].need).toBeNull();
    expect(screenNeed).not.toHaveBeenCalled();
  });

  it("clears a Claude question dismissed with Esc, once its box is back", async () => {
    applyProgramReport(
      NAME,
      {
        state: "blocked",
        id: "",
        kind: "question",
        app: "claude-code",
        msg: "Which?",
      },
      "claude"
    );
    const asked = programSummary(NAME)!;
    const idle = fixture("claude-idle.ans");
    expect(questionDismissed(asked, idle, asked.at + 1000)).toBe(false);
    expect(
      questionDismissed(asked, fixture("claude-question.ans"), asked.at + 9000)
    ).toBe(false);
    expect(questionDismissed(asked, idle, asked.at + 9000)).toBe(true);
    expect(
      questionDismissed({ ...asked, kind: "permission" }, idle, asked.at + 9000)
    ).toBe(false);

    pane = fixture("claude-question.ans");
    expect((await collectStatuses()).statuses[SID].need).toBe("answer");
    vi.useFakeTimers({ now: asked.at + 9000, toFake: ["Date"] });
    try {
      pane = idle;
      const { statuses } = await collectStatuses();
      expect(programSummary(NAME)?.state).toBe("idle");
      expect(statuses[SID]).toMatchObject({ status: "idle", need: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it("doesn't read a working terminal's screen for needs, and forgets its typed text", async () => {
    screen.mockResolvedValue("running");
    screenNeed.mockReturnValue({ need: "unsent", detail: "x" });
    const { statuses } = await collectStatuses();
    expect(statuses[SID]).toMatchObject({ status: "running", need: null });
    expect(screenNeed).not.toHaveBeenCalled();
    expect(clearUnsent).toHaveBeenCalledWith(NAME);
  });

  it("looks again when typed text turns unsent, with nothing new on screen", async () => {
    await terminalsChanged();
    expect(await terminalsChanged()).not.toBe("changed");
    unsentDue.mockReturnValue(true);
    expect(await terminalsChanged()).toBe("changed");
  });

  it("forgets typed text while the program reports working or blocked", async () => {
    for (const state of ["working", "blocked"] as const) {
      clearUnsent.mockClear();
      applyProgramReport(NAME, { state, id: "" }, "claude");
      await collectStatuses();
      expect(clearUnsent, state).toHaveBeenCalledWith(NAME);
      expect(screenNeed).not.toHaveBeenCalled();
    }
  });
});
