import { describe, expect, it } from "vitest";
import type { Session } from "../db/types";
import {
  addableKinds,
  headItems,
  memberDot,
  memberIdleText,
  orchestratorRowText,
  orchestratorsToStart,
  teamMembers,
  teamRowText,
} from "./orchestrator-row";
import { buildShelves } from "./shelves";

const quiet = { asks: 0, paused: false, running: 0, inReview: 0, queued: 0 };
const idle = { need: null, working: false, unread: false };

describe("orchestratorRowText", () => {
  it("shows the open asks count, singular and plural", () => {
    expect(orchestratorRowText(idle, quiet).asks).toBeNull();
    expect(orchestratorRowText(idle, { ...quiet, asks: 1 }).asks).toBe("1 ask");
    expect(orchestratorRowText(idle, { ...quiet, asks: 3 }).asks).toBe(
      "3 asks"
    );
  });

  it("says what it's doing, paused first, with the workspace's counts", () => {
    expect(orchestratorRowText({ ...idle, working: true }, quiet).status).toBe(
      "Working"
    );
    expect(
      orchestratorRowText(
        { need: "answer", working: true, unread: true },
        { ...quiet, paused: true, running: 2, inReview: 1 }
      ).status
    ).toBe("Paused · 2 running · 1 in review");
    expect(
      orchestratorRowText({ ...idle, need: "failed", unread: true }, quiet)
        .status
    ).toBe("Failed");
    expect(orchestratorRowText(idle, quiet).status).toBe("Idle");
  });

  it("is Working mid-turn even with an unseen reply", () => {
    expect(
      orchestratorRowText({ ...idle, working: true, unread: true }, quiet).state
    ).toBe("Working");
  });

  it("is Replied when idle with an unseen reply, before Waiting", () => {
    expect(
      orchestratorRowText({ ...idle, unread: true }, { ...quiet, running: 2 })
        .status
    ).toBe("Replied · 2 running");
  });

  it("is Waiting while tasks run, PRs are open or tasks are queued", () => {
    expect(
      orchestratorRowText(idle, { ...quiet, running: 2, inReview: 1 }).status
    ).toBe("Waiting · 2 running · 1 in review");
    expect(orchestratorRowText(idle, { ...quiet, inReview: 1 }).state).toBe(
      "Waiting"
    );
    expect(orchestratorRowText(idle, { ...quiet, queued: 3 }).status).toBe(
      "Waiting"
    );
  });

  it("is Idle only with nothing in flight, asks or not", () => {
    expect(orchestratorRowText(idle, { ...quiet, asks: 2 })).toEqual({
      state: "Idle",
      status: "Idle",
      asks: "2 asks",
    });
  });
});

describe("orchestratorsToStart", () => {
  const workspaces = [
    { id: "w1", name: "Poise" },
    { id: "w2", name: "Connect" },
    { id: "w3", name: "Home" },
  ];
  // w1 has none; w2's was unpinned (it still exists); w3 has none.
  const overviews = [
    { workspaceId: "w1", sessionId: null },
    { workspaceId: "w2", sessionId: "o2" },
    { workspaceId: "w3", sessionId: null },
  ];
  const all = { workspaces, workspaceId: null, projectId: null, query: "" };

  it("offers one per shown workspace that has none, never an unpinned one", () => {
    expect(orchestratorsToStart(overviews, all)).toEqual([
      { workspaceId: "w1", name: "Poise" },
      { workspaceId: "w3", name: "Home" },
    ]);
    expect(
      orchestratorsToStart(overviews, { ...all, workspaceId: "w1" })
    ).toEqual([{ workspaceId: "w1", name: "Poise" }]);
    expect(
      orchestratorsToStart(overviews, { ...all, workspaceId: "w2" })
    ).toEqual([]);
  });

  it("hides under a chosen project and follows the search", () => {
    expect(
      orchestratorsToStart(overviews, { ...all, projectId: "p1" })
    ).toEqual([]);
    expect(
      orchestratorsToStart(overviews, { ...all, query: "poi" }).map(
        (w) => w.workspaceId
      )
    ).toEqual(["w1"]);
    expect(
      orchestratorsToStart(overviews, { ...all, query: "orchestrator" })
    ).toHaveLength(2);
    expect(orchestratorsToStart(overviews, { ...all, query: "zzz" })).toEqual(
      []
    );
  });

  it("offers nothing while the overview hasn't loaded", () => {
    expect(orchestratorsToStart([], all)).toEqual([]);
  });
});

describe("teams", () => {
  const at = (n: number) => `2026-11-0${n} 10:00:00`;
  const s = (id: string, ws: string, n: number, over: Partial<Session> = {}) =>
    ({
      id,
      name: id,
      workspace_id: ws,
      role: "lead",
      pinned: true,
      created_at: at(n),
      updated_at: at(n),
      ...over,
    }) as Session;
  // w1 has a team; w2 (older) has only its orchestrator.
  const sessions = [
    s("w1-product", "w1", 2),
    s("w1-tech", "w1", 5, { role: "orchestrator" }),
    s("w2-orch", "w2", 1, { role: "orchestrator" }),
    s("w1-chief", "w1", 6, { role: "chief" }),
  ];
  const team = teamMembers([
    {
      workspaceId: "w1",
      team: [
        { kind: "chief", title: "Chief of staff", sessionId: "w1-chief" },
        { kind: "tech", title: "Tech lead", sessionId: "w1-tech" },
        { kind: "product", title: "Product lead", sessionId: "w1-product" },
      ],
    },
    { workspaceId: "w2" },
  ]);
  const heads = buildShelves({
    sessions,
    statuses: {},
    tasks: {},
    projectName: () => "",
    currentOrchestrators: new Set(["w2-orch", ...team.keys()]),
    leadRanks: new Map([...team].map(([id, m]) => [id, m.rank])),
  }).orchestrators;

  it("keeps each team together, in team order, workspaces oldest first", () => {
    expect(heads.map((r) => r.session.id)).toEqual([
      "w2-orch",
      "w1-chief",
      "w1-tech",
      "w1-product",
    ]);
    expect(team.get("w1-chief")!.letter).toBe("C");
    expect(team.get("w1-product")!.letter).toBe("P");
  });

  it("labels a team, or folds it into one row", () => {
    expect(headItems(heads, team, false).map((h) => h.kind)).toEqual([
      "row",
      "label",
      "row",
      "row",
      "row",
    ]);
    const folded = headItems(heads, team, true);
    expect(folded.map((h) => h.kind)).toEqual(["row", "team"]);
    expect(
      folded[1].kind === "team" && folded[1].rows.map((r) => r.session.id)
    ).toEqual(["w1-chief", "w1-tech", "w1-product"]);
  });

  it("puts a dashed row per missing shipped lead under its team, never folded", () => {
    const addable = addableKinds(team);
    expect(addable).toEqual(new Map([["w1", ["marketing"]]]));
    const items = headItems(heads, team, false, addable);
    expect(items.map((h) => h.kind)).toEqual([
      "row",
      "label",
      "row",
      "row",
      "row",
      "add",
    ]);
    expect(items[5]).toEqual({
      kind: "add",
      workspaceId: "w1",
      leadKind: "marketing",
    });
    expect(headItems(heads, team, true, addable).map((h) => h.kind)).toEqual([
      "row",
      "team",
    ]);
  });

  it("says what a folded team needs and is doing", () => {
    expect(teamRowText([idle], quiet)).toEqual({ needs: null, status: "Idle" });
    expect(
      teamRowText([idle, { ...idle, working: true }], {
        ...quiet,
        asks: 2,
        running: 3,
      })
    ).toEqual({ needs: "2 needs you", status: "3 running" });
    expect(teamRowText([idle], { ...quiet, paused: true, running: 1 })).toEqual(
      { needs: null, status: "Paused · 1 running" }
    );
  });

  it("dots an avatar by what matters most", () => {
    expect(memberDot({ ...idle, need: "failed" }, 2)).toBe("failed");
    expect(memberDot({ ...idle, working: true }, 1)).toBe("asks");
    expect(memberDot({ ...idle, working: true }, 0)).toBe("working");
    expect(memberDot({ ...idle, unread: true }, 0)).toBe("replied");
    expect(memberDot(idle, 0)).toBe("idle");
  });
});

describe("memberIdleText", () => {
  it("says the chief is quiet and a new lead has no direction, only when idle", () => {
    expect(memberIdleText({ kind: "chief" }, "Idle", 0)).toBe(
      "Nothing needs you · all quiet"
    );
    expect(memberIdleText({ kind: "marketing", pins: 0 }, "Idle", 0)).toMatch(
      /^New · no direction yet/
    );
    expect(
      memberIdleText({ kind: "marketing", pins: 2 }, "Idle", 0)
    ).toBeNull();
    expect(memberIdleText({ kind: "tech", pins: 0 }, "Idle", 0)).toBeNull();
    expect(memberIdleText({ kind: "chief" }, "Working", 0)).toBeNull();
    expect(memberIdleText({ kind: "product", pins: 0 }, "Idle", 1)).toBeNull();
  });
});
