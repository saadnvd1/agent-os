import { describe, expect, it } from "vitest";
import {
  movableSession,
  movableTask,
  moveTargets,
  type Movable,
} from "./move-targets";

const box = { id: "h1", name: "devbox" };
const spare = { id: "h2", name: "spare" };
const here: Movable = {
  hostId: "local",
  live: true,
  moving: false,
  movedTo: null,
  branch: "feature/x",
  pinnedHere: false,
};
const labels = (m: Movable, linked = [box, spare]) =>
  moveTargets(m, linked).map((t) => [t.hostId, t.label]);

describe("where a task can move", () => {
  it("offers every linked machine for a task running here", () => {
    expect(labels(here)).toEqual([
      ["h1", "Move to devbox"],
      ["h2", "Move to spare"],
    ]);
    expect(labels({ ...here, hostId: null })).toHaveLength(2);
  });

  it("offers only the way back for one running on another machine", () => {
    expect(labels({ ...here, hostId: "h1" })).toEqual([
      ["local", "Move back to this machine"],
    ]);
    // Even when this machine has no links left to offer.
    expect(labels({ ...here, hostId: "h1" }, [])).toHaveLength(1);
  });

  it("only finishes a move that stopped partway, to where it was going", () => {
    const stuck = { ...here, moving: true, movedTo: "spare" };
    expect(labels(stuck)).toEqual([["h2", "Finish moving to spare"]]);
    expect(labels({ ...stuck, movedTo: "gone" })).toEqual([]);
  });

  it.each([
    ["has no branch", { branch: null }],
    ["has finished", { live: false }],
    ["is on a card or is an orchestrator", { pinnedHere: true }],
  ])("offers nothing when it %s", (_, change) => {
    expect(labels({ ...here, ...change })).toEqual([]);
  });

  it("offers nothing with no linked machine", () => {
    expect(labels(here, [])).toEqual([]);
  });
});

describe("reading a session or a task view", () => {
  const session = {
    host_id: "local",
    task_status: "running",
    moved_to: null,
    branch_name: "feature/x",
    lh_card_id: null,
    role: null,
  };

  it("a plain session (no task) can't move", () => {
    expect(movableSession({ ...session, task_status: null }).live).toBe(false);
    expect(movableSession({ ...session, task_status: "moved" }).live).toBe(
      false
    );
  });

  it("a stuck move keeps where it was going", () => {
    expect(
      movableSession({ ...session, task_status: "moving", moved_to: "spare" })
    ).toMatchObject({ live: true, moving: true, movedTo: "spare" });
  });

  it("card tasks and orchestrators stay here", () => {
    expect(movableSession({ ...session, lh_card_id: "c1" }).pinnedHere).toBe(
      true
    );
    expect(
      movableSession({ ...session, role: "orchestrator" }).pinnedHere
    ).toBe(true);
  });

  it("a chat task moves like a terminal one", () => {
    const chat = movableSession({ ...session, view: "chat" } as typeof session);
    expect(moveTargets(chat, [box]).map((t) => t.label)).toEqual([
      "Move to devbox",
    ]);
    const away = movableSession({
      ...session,
      host_id: "h1",
      view: "chat",
    } as typeof session);
    expect(moveTargets(away, [box]).map((t) => t.label)).toEqual([
      "Move back to this machine",
    ]);
  });

  it("a task view that ended can't move; one moving can", () => {
    const view = { hostId: null, branch: "b", cardUrl: null };
    expect(movableTask({ ...view, state: "merged" }).live).toBe(false);
    expect(movableTask({ ...view, state: "moving" })).toMatchObject({
      live: true,
      moving: true,
    });
    expect(
      movableTask({ ...view, state: "working", cardUrl: "u" })
    ).toMatchObject({ pinnedHere: true });
  });
});
