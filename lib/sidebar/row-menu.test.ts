import { describe, expect, it } from "vitest";
import { rowMenu, type RowMenuInput } from "./row-menu";

const base: RowMenuInput = {
  session: {
    role: null,
    quick_of: null,
    pinned: false,
    view: "chat",
    agent_type: "claude",
    task_status: null,
    pr_url: null,
    has_brief: 0,
    archived_at: null,
    pause_state: null,
  } as RowMenuInput["session"],
  row: { task: undefined, wakesAt: undefined, settled: undefined },
  remote: false,
  canOpenInTab: true,
  hasCard: false,
  recipeRun: false,
  hasWorkspace: true,
  machineTargets: 0,
  otherProjects: 2,
};

const menu = (over: Partial<RowMenuInput> & { s?: object } = {}) => {
  const { s, ...rest } = over;
  return rowMenu({
    ...base,
    ...rest,
    session: { ...base.session, ...s } as RowMenuInput["session"],
  });
};

describe("rowMenu", () => {
  it("gives a plain session short top-level sections, danger last", () => {
    expect(menu().sections).toEqual([
      ["rename", "pin", "select"],
      [
        "open-tab",
        { group: "share", items: ["copy-link", "share"] },
        { group: "restart", items: ["fork", "fresh-start"] },
        { group: "move", items: ["move-project", "move-group"] },
        { group: "automate", items: ["check-ins", "save-recipe"] },
      ],
      ["snooze", "pause", "settle"],
      ["archive", "delete"],
    ]);
  });

  it("gives a running task Done and Pause, and a done task Restore only", () => {
    const run = menu({
      s: { task_status: "running" },
      row: { task: {} as never },
    }).sections;
    expect(run[2]).toEqual(["snooze", "pause", "done"]);
    const done = menu({
      s: { task_status: "done" },
      row: { task: {} as never },
    }).sections.flat();
    expect(done).toContain("restore");
    expect(done).not.toContain("pause");
    expect(done).not.toContain("done");
    expect(done).not.toContainEqual(
      expect.objectContaining({ items: expect.arrayContaining(["check-ins"]) })
    );
  });

  it("swaps Snooze for Unsnooze and Mark done for Reopen when shelved", () => {
    const flat = menu({
      row: { task: undefined, wakesAt: 5, settled: "manual" },
    }).sections[2];
    expect(flat).toEqual(["unsnooze", "pause", "reopen"]);
  });

  it("offers no Snooze to a pinned session", () => {
    expect(menu({ s: { pinned: true } }).sections[2]).toEqual([
      "pause",
      "settle",
    ]);
  });

  it("keeps a quick change to its PR, finishing and delete", () => {
    expect(
      menu({
        s: { quick_of: "o1", task_status: "running", pr_url: "u" },
      }).sections
    ).toEqual([["open-pr"], ["done"], ["archive", "delete"]]);
  });

  it("gives an orchestrator no snooze, pause, finish or delete", () => {
    expect(
      menu({ s: { role: "orchestrator", has_brief: 1 } }).sections
    ).toEqual([
      ["rename", "pin", "select"],
      [
        "open-tab",
        { group: "share", items: ["copy-link", "share"] },
        "new-conversation",
      ],
    ]);
  });

  it("hides, not disables, what a linked machine can't do", () => {
    const { sections, remoteNote } = menu({ remote: true });
    const all = JSON.stringify(sections);
    for (const gone of ["fork", "fresh-start", "move-project", "check-ins"])
      expect(all).not.toContain(`"${gone}"`);
    expect(remoteNote).toBe(true);
    expect(menu().remoteNote).toBe(false);
  });

  it("merges machine and project moves into one group", () => {
    const flat = menu({ machineTargets: 1 }).sections[1];
    expect(flat).toContainEqual({
      group: "move",
      items: ["move-machine", "move-project", "move-group"],
    });
  });

  it("offers Move to group on an agent session, even on a linked machine", () => {
    expect(JSON.stringify(menu().sections)).toContain("move-group");
    expect(JSON.stringify(menu({ remote: true }).sections)).toContain(
      "move-group"
    );
    expect(
      JSON.stringify(menu({ s: { role: "orchestrator" } }).sections)
    ).not.toContain("move-group");
  });

  it("shows a recipe run's items instead of Save as recipe", () => {
    const sec = JSON.stringify(menu({ recipeRun: true }).sections);
    expect(sec).toContain("run-again");
    expect(sec).toContain("open-recipe");
    expect(sec).not.toContain("save-recipe");
  });

  const finishItems = (over: Parameters<typeof menu>[0]) =>
    menu(over)
      .sections.flat()
      .filter((i) => i === "done" || i === "restore");

  it.each([
    ["done", "restore"],
    ["dropped", "restore"],
  ])("offers a %s task %s, never Done", (task_status, want) => {
    expect(finishItems({ s: { task_status } })).toEqual([want]);
  });

  it("offers a merged task neither Done nor Restore", () => {
    expect(finishItems({ s: { task_status: "merged" } })).toEqual([]);
  });

  it("offers a plain session on the Done shelf Reopen, not Done or Restore", () => {
    const row = { ...base.row!, settled: "manual" as const };
    const items = menu({ row }).sections.flat();
    expect(items).toContain("reopen");
    expect(items).not.toContain("done");
    expect(items).not.toContain("restore");
  });

  it("offers a running task Done", () => {
    expect(finishItems({ s: { task_status: "running" } })).toEqual(["done"]);
  });
});
