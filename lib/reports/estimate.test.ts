import { describe, expect, it } from "vitest";
import { computeEstimate, type Stages } from "./estimate";
import { ev, HEAD } from "./fixtures";

const stages: Stages = {
  planned: true,
  pushed: true,
  prOpen: true,
  ciGreen: false,
  reviewed: false,
  merged: false,
};
const base = { head: HEAD, stages, mappings: [] };

describe("computeEstimate", () => {
  it("counts delivery stages when the plan has no acceptance items", () => {
    const e = computeEstimate({ ...base, evidence: [], items: [] });
    expect(e).toMatchObject({ basis: "stages", done: 3, total: 6 });
    expect(e.items).toHaveLength(6);
  });

  it("verifies an item only from passing, current, proving evidence", () => {
    const evidence = [
      ev("test:1", "test", "pass", { sha: HEAD }),
      ev("diff:a.ts", "diff", "info"),
    ];
    const items = [{ label: "a" }, { label: "b" }, { label: "c" }];
    const e = computeEstimate({
      ...base,
      evidence,
      items,
      mappings: [
        { item: 0, evidence: ["test:1"] },
        { item: 1, evidence: ["diff:a.ts"] }, // a diff alone proves nothing
        { item: 2, evidence: ["test:404"] }, // unknown id
      ],
    });
    expect(e).toMatchObject({ basis: "acceptance", done: 1, total: 3 });
    expect(e.items.map((i) => i.verified)).toEqual([true, false, false]);
  });

  it("does not verify from evidence of an older head", () => {
    const e = computeEstimate({
      ...base,
      evidence: [ev("test:1", "test", "pass", { sha: "old0000" })],
      items: [{ label: "a" }],
      mappings: [{ item: 0, evidence: ["test:1"] }],
    });
    expect(e.done).toBe(0);
  });

  it("unverifies an item while evidence of the same kind fails at head", () => {
    const e = computeEstimate({
      ...base,
      evidence: [
        ev("test:1", "test", "pass", { sha: HEAD }),
        ev("test:2", "test", "fail", { sha: HEAD }),
      ],
      items: [{ label: "a" }],
      mappings: [{ item: 0, evidence: ["test:1"] }],
    });
    expect(e.done).toBe(0);
  });

  it("takes a system-verified item without a model mapping", () => {
    const e = computeEstimate({
      ...base,
      evidence: [ev("accept:1", "accept", "pass")],
      items: [{ label: "a", evidence: ["accept:1"] }, { label: "b" }],
    });
    expect(e).toMatchObject({ done: 1, total: 2 });
  });

  it("a merged task with unverified items stays below its total", () => {
    const e = computeEstimate({
      ...base,
      stages: { ...stages, merged: true },
      evidence: [],
      items: [{ label: "a" }],
    });
    expect(e.done).toBeLessThan(e.total);
  });
});
