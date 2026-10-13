import { describe, expect, it } from "vitest";
import { checkPieces, pieceBrief, type ProjectRef } from "./pieces";

const web: ProjectRef = { id: "p1", name: "web", deploys: true };
const mobile: ProjectRef = { id: "p2", name: "mobile", deploys: false };
const ctx = {
  own: web,
  find: (n: string) => [web, mobile].find((p) => p.name === n) ?? null,
};
const plan = (block: string) => `# Plan\nstuff\n\n## Pieces\n${block}\n`;

describe("checkPieces", () => {
  it("no block, or one item, is one piece", () => {
    expect(checkPieces("# Plan", ctx).pieces).toHaveLength(1);
    const r = checkPieces(plan("1. Core: all of it  (repo: web)"), ctx);
    expect(r.pieces).toHaveLength(1);
    expect(r.pieces[0]).toMatchObject({ name: "Core", slice: "all of it" });
  });

  it("a malformed block is one piece with a warning", () => {
    const r = checkPieces(plan("1. A: x\nnonsense line"), ctx);
    expect(r.pieces).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/couldn't be read/);
    expect(checkPieces(plan("2. A: x"), ctx).warnings).toHaveLength(1);
  });

  it("a later piece with no reason is folded into the one before", () => {
    const r = checkPieces(plan("1. A: first\n2. B: second\n"), ctx);
    expect(r.pieces).toHaveLength(1);
    expect(r.pieces[0].slice).toContain("B: second");
    expect(r.folded).toEqual([
      { name: "B", into: 1, why: "no reason for a separate piece" },
    ]);
  });

  it("(a) stands across repos, not within one", () => {
    const ok = checkPieces(
      plan(
        "1. A: x  (repo: web)\n2. B: y  (repo: mobile)\n   after: 1 is merged\n   why split: (a)"
      ),
      ctx
    );
    expect(ok.pieces.map((p) => p.project.id)).toEqual(["p1", "p2"]);
    expect(ok.pieces[1]).toMatchObject({
      afterPosition: 1,
      afterKind: "merged",
    });
    const same = checkPieces(
      plan("1. A: x  (repo: web)\n2. B: y  (repo: web)\n   why split: (a)"),
      ctx
    );
    expect(same.pieces).toHaveLength(1);
  });

  it("(b) needs a checkable deploy, else downgrades and needs another reason", () => {
    const good = checkPieces(
      plan(
        "1. A: x  (repo: web)\n2. B: y  (repo: mobile)\n   after: 1 is deployed\n   why split: (b)"
      ),
      ctx
    );
    expect(good.pieces[1]).toMatchObject({ afterKind: "deployed" });
    const blind = checkPieces(
      plan(
        "1. A: x  (repo: mobile)\n2. B: y  (repo: web)\n   after: 1 is deployed\n   why split: (b)"
      ),
      ctx
    );
    expect(blind.pieces).toHaveLength(1);
    const kept = checkPieces(
      plan(
        "1. A: x  (repo: mobile)\n2. B: y  (repo: web)\n   after: 1 is deployed\n   why split: (b) + (c)"
      ),
      ctx
    );
    expect(kept.pieces[1]).toMatchObject({
      afterKind: "merged",
      reasons: ["c"],
    });
    expect(kept.warnings.join()).toMatch(/can't check/);
  });

  it("after: only points backwards and follows folds", () => {
    const r = checkPieces(
      plan(
        "1. A: x\n2. B: y\n3. C: z\n   after: 2 is merged\n   why split: (c)"
      ),
      ctx
    );
    expect(r.pieces).toHaveLength(2);
    expect(r.pieces[1]).toMatchObject({ position: 2, afterPosition: 1 });
    const fwd = checkPieces(
      plan("1. A: x\n2. B: y\n   after: 3 is merged\n   why split: (c)"),
      ctx
    );
    expect(fwd.pieces[1].afterPosition).toBeNull();
  });

  it("warns when two pieces own the same thing", () => {
    const r = checkPieces(
      plan(
        "1. A: x\n   owns: migration 81\n2. B: y\n   why split: (d)\n   owns: Migration 81"
      ),
      ctx
    );
    expect(r.warnings.join()).toMatch(/migration 81/);
  });

  it("more than six pieces is one piece", () => {
    const items = [1, 2, 3, 4, 5, 6, 7]
      .map((n) => `${n}. P${n}: s\n   why split: (c)`)
      .join("\n");
    const r = checkPieces(plan(items), ctx);
    expect(r.pieces).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/limit/);
  });
});

describe("pieceBrief", () => {
  it("carries the slice, what it owns, earlier pieces and the plan path", () => {
    const text = pieceBrief(
      2,
      { position: 2, name: "B", slice: "do y", owns: ["migration 81"] },
      "/plans/f.md",
      ["1 merged as #241"]
    );
    expect(text).toContain("piece 2 of 2");
    expect(text).toContain("migration 81");
    expect(text).toContain("1 merged as #241");
    expect(text).toContain("/plans/f.md");
  });
});
