import { describe, expect, it } from "vitest";
import { bash, input, releaseToTesters } from "./__fixtures__/sessions";
import {
  commandStart,
  isExternal,
  jaccard,
  recipeSignals,
  words,
} from "./signals";

describe("recipeSignals", () => {
  it("flags a release-to-testers session", () => {
    const r = recipeSignals(releaseToTesters());
    expect(r.hit).toBe(true);
    expect(r.signals).toEqual(
      expect.arrayContaining(["external", "outside-repo", "facts"])
    );
  });

  it("does not flag a plain repo refactor", () => {
    const r = recipeSignals(
      input({ steps: [bash("npm test"), bash("git diff")] })
    );
    expect(r).toEqual({ hit: false, signals: [] });
  });

  it("external CLIs without a report of facts is not enough", () => {
    const r = recipeSignals(
      input({ steps: [bash("gh api repos/x/y")], final: "Looked at it." })
    );
    expect(r.hit).toBe(false);
  });

  it("flags a brief that repeats an earlier one", () => {
    const brief = "Run the weekly dependency audit and summarise the findings";
    const r = recipeSignals(
      input({
        brief,
        recentBriefs: [
          "Run the weekly dependency audit and summarise findings",
        ],
      })
    );
    expect(r.signals).toContain("repeat");
    expect(r.hit).toBe(true);
  });

  it("ignores an unrelated earlier brief and very short ones", () => {
    expect(
      recipeSignals(input({ recentBriefs: ["Fix the login button colour"] }))
        .hit
    ).toBe(false);
    expect(
      recipeSignals(input({ brief: "fix it", recentBriefs: ["fix it"] })).hit
    ).toBe(false);
  });

  it("skips a session that ran from a recipe or is skipped", () => {
    const run = {
      status: "succeeded",
      summary: "",
      error: "",
      settled: true,
      recipeId: "r",
    };
    expect(recipeSignals({ ...releaseToTesters(), run }).hit).toBe(false);
    expect(
      recipeSignals({ ...releaseToTesters(), skip: "quick change" }).hit
    ).toBe(false);
  });
});

describe("helpers", () => {
  it("reads past cd, env assignments and npx", () => {
    expect(commandStart("cd x && FOO=1 npx eas submit")).toBe("eas submit");
    expect(isExternal("cd app && eas build")).toBe(true);
    expect(isExternal("gh pr view 3")).toBe(false);
    expect(isExternal("gh api repos")).toBe(true);
    expect(isExternal("assert-thing")).toBe(false);
  });

  it("compares word sets without numbers or stopwords", () => {
    expect(words("Build 57 of the app")).toEqual(new Set(["build", "app"]));
    expect(jaccard(new Set(["a1", "b1"]), new Set(["a1", "c1"]))).toBeCloseTo(
      1 / 3
    );
  });
});
