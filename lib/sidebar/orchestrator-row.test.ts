import { describe, expect, it } from "vitest";
import { orchestratorRowText, orchestratorsToStart } from "./orchestrator-row";

const quiet = { asks: 0, paused: false, running: 0, inReview: 0 };

describe("orchestratorRowText", () => {
  it("shows the open asks count, singular and plural", () => {
    const idle = { need: null, working: false };
    expect(orchestratorRowText(idle, quiet).asks).toBeNull();
    expect(orchestratorRowText(idle, { ...quiet, asks: 1 }).asks).toBe("1 ask");
    expect(orchestratorRowText(idle, { ...quiet, asks: 3 }).asks).toBe(
      "3 asks"
    );
  });

  it("says what it's doing, paused first, with the workspace's counts", () => {
    expect(
      orchestratorRowText({ need: null, working: true }, quiet).status
    ).toBe("Working");
    expect(
      orchestratorRowText(
        { need: "answer", working: true },
        { ...quiet, paused: true, running: 2, inReview: 1 }
      ).status
    ).toBe("Paused · 2 running · 1 in review");
    expect(
      orchestratorRowText({ need: "failed", working: false }, quiet).status
    ).toBe("Failed");
    expect(
      orchestratorRowText({ need: null, working: false }, quiet).status
    ).toBe("Idle");
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
