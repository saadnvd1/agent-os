import { describe, expect, it } from "vitest";
import type { SessionArtifact } from "@/lib/session-artifacts/types";
import {
  counts,
  folderOf,
  groups,
  prNumber,
  stateLabel,
  step,
  visible,
} from "./helpers";

const a = (
  id: string,
  kind: SessionArtifact["kind"],
  state: SessionArtifact["state"] = "live"
): SessionArtifact => ({
  id,
  kind,
  name: id,
  at: 0,
  state,
  preview: "text",
});

const all = [
  a("plan", "plan"),
  { ...a("pr", "pr"), name: "PR #231" },
  a("f1", "file"),
  a("f2", "file", "in-pr"),
  a("f3", "file", "gone"),
  a("p1", "page"),
  a("i1", "image", "kept"),
  a("l1", "log"),
];

describe("artifacts view", () => {
  it("hides what's gone unless asked, and filters by type", () => {
    expect(visible(all, "all", false).map((x) => x.id)).toEqual([
      "plan",
      "pr",
      "f1",
      "p1",
      "i1",
      "l1",
    ]);
    expect(visible(all, "files", true).map((x) => x.id)).toEqual([
      "f1",
      "f2",
      "f3",
    ]);
    expect(counts(all, false)).toEqual({
      all: 6,
      files: 1,
      pages: 1,
      images: 1,
      logs: 1,
    });
  });

  it("groups in the panel's order, leaving out empty groups", () => {
    expect(
      groups(visible(all, "all", false)).map((g) => [g.label, g.items.length])
    ).toEqual([
      ["Plan & PR", 2],
      ["Pages", 1],
      ["Files", 1],
      ["Images", 1],
      ["Logs", 1],
    ]);
  });

  it("labels where a file is", () => {
    expect(prNumber(all)).toBe("231");
    expect(stateLabel(all[3], "231")).toBe("in PR #231");
    expect(stateLabel(all[3], null)).toBe("committed");
    expect(stateLabel(all[6], null)).toBe("kept copy");
    expect(stateLabel(all[2], null)).toBeNull();
    expect(folderOf("~/r/src/a.ts")).toBe("~/r/src/");
  });

  it("moves with the arrow keys without wrapping", () => {
    const list = all.slice(0, 3);
    expect(step(list, null, 1)).toBe("plan");
    expect(step(list, "plan", 1)).toBe("pr");
    expect(step(list, "plan", -1)).toBe("plan");
    expect(step(list, "f1", 1)).toBe("f1");
    expect(step([], null, 1)).toBeNull();
  });
});
