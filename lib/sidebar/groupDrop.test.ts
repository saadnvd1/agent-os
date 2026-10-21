import { describe, expect, it } from "vitest";
import { dropOutcome, type DraggedSession } from "./groupDrop";

const ungrouped: DraggedSession = {
  id: "s1",
  groupId: null,
  workspaceId: "w1",
};
const grouped: DraggedSession = { ...ungrouped, groupId: "g1" };

describe("dropOutcome", () => {
  it("files a session into the group it lands on", () => {
    expect(
      dropOutcome(ungrouped, { groupId: "g1", workspaceId: "w1" })
    ).toEqual({ groupId: "g1" });
    expect(dropOutcome(grouped, { groupId: "g2", workspaceId: "w1" })).toEqual({
      groupId: "g2",
    });
  });

  it("takes a grouped session out when dropped outside any group", () => {
    expect(dropOutcome(grouped, null)).toEqual({ groupId: null });
  });

  it("does nothing on its own group, or outside for an ungrouped session", () => {
    expect(
      dropOutcome(grouped, { groupId: "g1", workspaceId: "w1" })
    ).toBeNull();
    expect(dropOutcome(ungrouped, null)).toBeNull();
  });

  it("refuses a group of another workspace", () => {
    expect(
      dropOutcome(ungrouped, { groupId: "g9", workspaceId: "w2" })
    ).toBeNull();
  });
});
