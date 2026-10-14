import { describe, expect, it } from "vitest";
import type { Session } from "@/lib/db/types";
import type { SidebarRow } from "./shelves";
import { rowKindBadge, rowStatusBadge } from "./row-badge";
import { rowDetails, rowState } from "./row-details";

const NOW = Date.parse("2026-10-14T18:00:00Z");

function row(
  over: Partial<Session> = {},
  rowOver: Partial<SidebarRow> = {}
): SidebarRow {
  return {
    session: {
      id: "s1",
      name: "Speed up the list",
      project_id: "p1",
      role: null,
      chat_plan: 0,
      task_status: "running",
      ...over,
    } as Session,
    status: undefined,
    need: null,
    unread: false,
    working: true,
    workers: [],
    activeAt: NOW - 5 * 60_000,
    ...rowOver,
  };
}

describe("rowKindBadge", () => {
  it("badges a plan step and plan mode as planning", () => {
    expect(rowKindBadge(row({ plan_phase: "planning" }))?.kind).toBe(
      "planning"
    );
    expect(rowKindBadge(row({ chat_plan: 1 }))?.kind).toBe("planning");
    expect(rowKindBadge(row({ chat_plan: true }))?.kind).toBe("planning");
  });

  it("reads SQLite's 0 as no plan mode", () => {
    expect(rowKindBadge(row({ chat_plan: 0 }))).toBeNull();
  });

  it("badges a written plan, from the task or the session", () => {
    expect(rowKindBadge(row({}, { task: "plan-ready" }))?.kind).toBe(
      "plan-ready"
    );
    expect(rowKindBadge(row({ plan_phase: "awaiting" }))?.label).toBe(
      "Plan ready"
    );
  });

  it("shows nothing while implementing or for a plain row", () => {
    expect(rowKindBadge(row({ plan_phase: "implementing" }))).toBeNull();
    expect(
      rowKindBadge(row({ plan_phase: "implementing", chat_plan: 1 }))
    ).toBeNull();
    expect(rowKindBadge(row())).toBeNull();
  });

  it("gives way to a need or a stall", () => {
    const planning = { plan_phase: "planning" as const };
    expect(rowKindBadge(row(planning, { need: "approve" }))).toBeNull();
    expect(rowKindBadge(row(planning, { need: "failed" }))).toBeNull();
    expect(
      rowKindBadge(row(planning, { status: { stalled: true } }))
    ).toBeNull();
  });

  it("shows nothing on resting, finished, quick-change or orchestrator rows", () => {
    const p = { plan_phase: "awaiting" as const };
    expect(rowKindBadge(row(p, { settled: "manual" }))).toBeNull();
    expect(rowKindBadge(row(p, { wakesAt: NOW + 1 }))).toBeNull();
    expect(rowKindBadge(row({ ...p, task_status: "merged" }))).toBeNull();
    expect(rowKindBadge(row({ ...p, quick_of: "o1" }))).toBeNull();
    expect(rowKindBadge(row({ ...p, role: "orchestrator" }))).toBeNull();
  });

  it("says plan only in the tip, not the label", () => {
    const b = rowKindBadge(row({ plan_phase: "planning", plan_only: 1 }));
    expect(b?.label).toBe("Planning");
    expect(b?.tip).toMatch(/plan only/);
  });
});

describe("rowDetails", () => {
  it("follows the badge's precedence for the state", () => {
    const planning = { plan_phase: "planning" as const };
    expect(rowState(row(planning, { need: "approve" }), NOW)).toBe(
      "Needs you: Approve"
    );
    expect(rowState(row({ ...planning, plan_only: 1 }), NOW)).toBe(
      "Planning (plan only)"
    );
    expect(rowState(row({}, { task: "plan-ready" }), NOW)).toMatch(
      /Plan ready/
    );
    expect(rowState(row(), NOW)).toBe("Working");
    expect(rowState(row({}, { working: false }), NOW)).toBe("Idle");
  });

  it("lists only what it has, with the full name as the title", () => {
    const d = rowDetails(
      row({
        recipe_run: JSON.stringify({ id: "r", name: "Dep bump", seq: 12 }),
        pr_number: 312,
      }),
      { project: "agent-os", host: "devbox" },
      NOW
    );
    expect(d.title).toBe("Speed up the list");
    expect(d.lines).toEqual([
      ["State", "Working"],
      ["Project", "agent-os"],
      ["Recipe", "Dep bump #12"],
      ["PR", "#312"],
      ["Machine", "devbox"],
      ["Last active", "5m ago"],
    ]);
  });

  it("says just now, and a date as it is", () => {
    const now = rowDetails(row({}, { activeAt: NOW }), {}, NOW);
    expect(now.lines.at(-1)).toEqual(["Last active", "just now"]);
    const old = rowDetails(
      row({}, { activeAt: NOW - 30 * 24 * 3600_000 }),
      {},
      NOW
    );
    expect(old.lines.at(-1)?.[1]).not.toMatch(/ago/);
  });
});

describe("rowStatusBadge", () => {
  it("says what it needs, then stalled, then the plan step", () => {
    expect(rowStatusBadge(row({}, { need: "failed" }))).toMatchObject({
      kind: "failed",
    });
    expect(rowStatusBadge(row({}, { need: "approve" }))?.kind).toBe("need");
    expect(rowStatusBadge(row({ plan_phase: "awaiting" }))?.kind).toBe(
      "plan-ready"
    );
    expect(rowStatusBadge(row())).toBeNull();
  });
});
