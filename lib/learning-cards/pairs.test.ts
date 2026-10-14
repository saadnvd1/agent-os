import { describe, expect, it } from "vitest";
import { bash, edit, input, said } from "./__fixtures__/sessions";
import { correctionPairs } from "./pairs";

describe("correctionPairs", () => {
  it("pairs a failed call with the same tool doing the job differently", () => {
    const pairs = correctionPairs(
      input({
        steps: [
          bash("npm run biuld", { ok: false, output: "Missing script" }),
          bash("npm run build"),
        ],
      })
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ kind: "tool-retry" });
    expect(pairs[0].before).toContain("Missing script");
    expect(pairs[0].after).toContain("npm run build");
  });

  it("does not pair an identical retry or a different job", () => {
    expect(
      correctionPairs(
        input({ steps: [bash("make", { ok: false }), bash("make")] })
      )
    ).toEqual([]);
    expect(
      correctionPairs(
        input({ steps: [bash("make", { ok: false }), bash("ls")] })
      )
    ).toEqual([]);
  });

  it("pairs edits to the same file", () => {
    const bad = { ...edit("a.ts", "one"), ok: false, failed: true };
    expect(
      correctionPairs(input({ steps: [bad, edit("a.ts", "two")] }))
    ).toHaveLength(1);
  });

  it("pairs a blocked review with a later pass, using the findings", () => {
    const pairs = correctionPairs(
      input({
        reviews: [
          { status: "block", detail: "Missing a migration" },
          { status: "pass", detail: "" },
        ],
      })
    );
    expect(pairs).toEqual([
      expect.objectContaining({
        kind: "review",
        before: "Missing a migration",
      }),
    ]);
    expect(
      correctionPairs(input({ reviews: [{ status: "block", detail: "x" }] }))
    ).toEqual([]);
  });

  it("pairs a person's correction with the change after it, not a peer's", () => {
    const steps = [
      said("Build the page"),
      edit("a.ts"),
      said("No, use the shared button instead"),
      edit("b.ts"),
    ];
    expect(correctionPairs(input({ steps }))).toEqual([
      expect.objectContaining({ kind: "user-correction" }),
    ]);
    const peer = steps.map((s) =>
      s.kind === "user" ? { ...s, byPerson: false } : s
    );
    expect(correctionPairs(input({ steps: peer }))).toEqual([]);
  });

  it("pairs a failed recipe run with the run that fixed it", () => {
    const ok = {
      status: "succeeded",
      summary: "built 58",
      error: "",
      settled: true,
      recipeId: "r",
    };
    const pairs = correctionPairs(
      input({
        run: ok,
        previousRun: {
          status: "failed",
          summary: "",
          error: "no signing key",
          settled: true,
        },
      })
    );
    expect(pairs).toEqual([
      expect.objectContaining({
        kind: "recipe-retry",
        before: "no signing key",
      }),
    ]);
  });

  it("caps pairs and clips each side", () => {
    const steps = Array.from({ length: 10 }, (_, i) => [
      bash(`tool${i} a`, { ok: false, output: "x".repeat(2000) }),
      bash(`tool${i} b`),
    ]).flat();
    const pairs = correctionPairs(input({ steps }));
    expect(pairs).toHaveLength(4);
    expect(pairs.every((p) => p.before.length <= 300)).toBe(true);
  });
});
