import { describe, expect, it } from "vitest";
import { findOverlaps, overlapBetween } from "./overlap";
import { goalsAlike } from "./goal";
import type { Claim } from "./types";

const WORDS =
  "apple bridge cactus dolphin engine falcon granite harbor island jungle kettle lantern meadow nectar orchard pepper quartz river saddle timber umbrella velvet walnut".split(
    " "
  );
let n = 0;
const claim = (o: Partial<Claim> = {}): Claim => ({
  id: `c${++n}`,
  origin: `m${n}`,
  originName: `box${n}`,
  viaMachine: null,
  hops: 0,
  source: "session",
  sessionId: null,
  sessionName: null,
  repo: "github.com/acme/widgets",
  branch: `feature/f${n}`,
  base: "main",
  goal: `${WORDS[n % WORDS.length]} ${WORDS[(n * 7 + 3) % WORDS.length]}`,
  files: [],
  filesMore: 0,
  prUrl: null,
  startedAt: 0,
  expiresAt: 1,
  released: null,
  updatedAt: 0,
  ...o,
});

describe("overlapBetween", () => {
  it("never compares different repos", () => {
    const a = claim({ files: ["a.ts", "b.ts", "c.ts"] });
    const b = claim({ repo: "github.com/acme/other", files: a.files });
    expect(overlapBetween(a, b)).toBeNull();
  });

  it("calls the same non-base branch strong, and the default branch nothing", () => {
    expect(
      overlapBetween(
        claim({ branch: "feature/x" }),
        claim({ branch: "feature/x" })
      )
    ).toMatchObject({ kinds: ["branch"], strength: "strong" });
    expect(
      overlapBetween(claim({ branch: "main" }), claim({ branch: "main" }))
    ).toBeNull();
  });

  it("treats a claim's own base as the default branch", () => {
    const a = claim({ branch: "develop", base: "develop" });
    expect(overlapBetween(a, claim({ branch: "develop" }))).toBeNull();
  });

  it("is not an overlap with the same session's branch on the same machine", () => {
    const a = claim({ origin: "m", branch: "feature/x" });
    expect(
      overlapBetween(a, claim({ origin: "m", branch: "feature/x" }))
    ).toBeNull();
  });

  it("scores shared files: one in a big set is nothing, three is strong", () => {
    const many = Array.from({ length: 10 }, (_, i) => `a/${i}.ts`);
    const other = Array.from({ length: 10 }, (_, i) => `b/${i}.ts`);
    expect(
      overlapBetween(
        claim({ files: many }),
        claim({ files: [...other, "a/0.ts"] })
      )
    ).toBeNull();
    expect(
      overlapBetween(
        claim({ files: many }),
        claim({ files: [...other, "a/0.ts", "a/1.ts"] })
      )
    ).toMatchObject({ kinds: ["files"], strength: "weak" });
    expect(
      overlapBetween(
        claim({ files: many }),
        claim({ files: [...other, "a/0.ts", "a/1.ts", "a/2.ts"] })
      )
    ).toMatchObject({ strength: "strong" });
  });

  it("ignores lockfiles, changelogs and the generated migration index", () => {
    const noise = [
      "pnpm-lock.yaml",
      "CHANGELOG.md",
      "lib/db/migrations.generated.ts",
    ];
    expect(
      overlapBetween(claim({ files: noise }), claim({ files: noise }))
    ).toBeNull();
  });

  it("discounts a file everyone edits, unless something else is shared", () => {
    const hub = "app/router.ts";
    const hubs = new Set([hub]);
    expect(
      overlapBetween(claim({ files: [hub] }), claim({ files: [hub] }), hubs)
    ).toBeNull();
  });

  it("calls similar goals weak alone, and strong with a few shared files", () => {
    const goal = "Cross machine work registry claims";
    expect(
      overlapBetween(
        claim({ goal }),
        claim({ goal: "Work registry for claims across machines" })
      )
    ).toMatchObject({ kinds: ["goal"], strength: "weak" });
    expect(
      overlapBetween(
        claim({ goal, files: ["a.ts", "b.ts"] }),
        claim({
          goal: "Work registry for claims across machines",
          files: ["a.ts", "b.ts"],
        })
      )
    ).toMatchObject({ strength: "strong" });
  });
});

describe("generated files", () => {
  const pyc = "scripts/__pycache__/x.cpython-312.pyc";
  it("are no overlap on their own", () => {
    expect(
      overlapBetween(claim({ files: [pyc] }), claim({ files: [pyc] }))
    ).toBeNull();
  });
  it("leave a real shared source file as an overlap", () => {
    const o = overlapBetween(
      claim({ files: [pyc, "src/a.py"] }),
      claim({ files: [pyc, "src/a.py"] })
    );
    expect(o?.shared).toEqual(["src/a.py"]);
  });
  it("only match directory segments, not names", () => {
    const files = ["build.ts", "dist.md", "src/build/x.ts"];
    expect(overlapBetween(claim({ files }), claim({ files }))?.shared).toEqual([
      "build.ts",
      "dist.md",
    ]);
  });
});

describe("goalsAlike", () => {
  it("needs real shared words, not task-title filler", () => {
    expect(goalsAlike("Fix the login bug", "Fix the sidebar bug")).toBe(false);
    expect(goalsAlike("Add OAuth login flow", "OAuth login flow for sso")).toBe(
      true
    );
  });
});

describe("findOverlaps", () => {
  it("finds a pair once, skips released claims, and treats a 4-way file as a hub", () => {
    const shared = claim({ files: ["x.ts", "y.ts", "z.ts"] });
    const twin = claim({ files: ["x.ts", "y.ts", "z.ts"] });
    expect(findOverlaps([shared, twin])).toHaveLength(1);
    expect(findOverlaps([shared, { ...twin, released: "done" }])).toHaveLength(
      0
    );
    const four = [1, 2, 3, 4].map(() => claim({ files: ["app/index.ts"] }));
    expect(findOverlaps(four)).toHaveLength(0);
  });
});
