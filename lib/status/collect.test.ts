import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import {
  applyProgramReport,
  programSummary,
  reloadProgramStatus,
} from "@/lib/program-status/store";
import { collectStatuses } from "./collect";

const SID = "0b5f4c1e-1111-4222-8333-944445555666";
const NAME = `claude-${SID}`;
let fg = "claude";
const screen = vi.fn(async () => "running" as const);

vi.mock("@/lib/status-detector", () => ({
  statusDetector: {
    refreshCache: async () => {},
    listSessions: async () => [{ name: NAME }],
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
  hostExec: async () => ({ stdout: "", stderr: "" }),
}));

beforeEach(() => {
  fg = "claude";
  screen.mockClear();
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
});
