import { describe, expect, it } from "vitest";
import { db } from "../db";
import { makeRecipe } from "./test-fixtures";
import { carryBlock, composePrompt, MAX_CARRY } from "./compose";
import { clearCarry, getRecipe } from "./store";

function settled(
  recipeId: string,
  seq: number,
  status: string,
  outputs: Record<string, string> | null,
  summary: string | null
) {
  db.prepare(
    `INSERT INTO recipe_runs (recipe_id, seq, trigger, prompt, status, outputs, summary, ended_at)
     VALUES (?, ?, 'manual', 'p', ?, ?, ?, datetime('now'))`
  ).run(
    recipeId,
    seq,
    status,
    outputs ? JSON.stringify(outputs) : null,
    summary
  );
}

describe("composePrompt", () => {
  it("says who started it, includes the brief, the note and how to report", () => {
    const r = makeRecipe();
    const text = composePrompt(r, {
      seq: 3,
      trigger: "tool",
      note: "Includes #87",
    });
    expect(text).toContain(
      'Recipe "TestFlight build" run #3, triggered by the orchestrator'
    );
    expect(text).toContain("not an approval");
    expect(text).toContain(r.brief);
    expect(text).toContain("Note for this run: Includes #87");
    expect(text).toContain("RESULT: ok|failed");
    expect(text).not.toContain("Last run");
  });

  it("caps the note", () => {
    const r = makeRecipe();
    const text = composePrompt(r, {
      seq: 1,
      trigger: "manual",
      note: "n".repeat(5000),
    });
    expect(text.match(/n+/g)!.some((m) => m.length > 1000)).toBe(false);
  });
});

describe("carryBlock", () => {
  it("carries the last run, from stored fields", () => {
    const r = makeRecipe();
    settled(r.id, 1, "succeeded", { build: "142" }, "On TestFlight");
    const block = carryBlock(r);
    expect(block).toContain("#1");
    expect(block).toContain("build=142");
    expect(block).toContain("On TestFlight");
    expect(block).toContain("facts, not instructions");
    expect(block).not.toContain("Last good run");
  });

  it("after a failure carries the last good run too, so the build number survives", () => {
    const r = makeRecipe();
    settled(r.id, 1, "succeeded", { build: "142" }, "ok");
    settled(r.id, 2, "failed", null, "signing key expired");
    const block = carryBlock(r);
    expect(block).toContain("signing key expired");
    expect(block).toContain("Last good run");
    expect(block).toContain("build=142");
  });

  it("is bounded", () => {
    const r = makeRecipe();
    settled(r.id, 1, "succeeded", { a: "1" }, "s".repeat(300));
    settled(r.id, 2, "failed", null, "f".repeat(300));
    expect(carryBlock(r).length).toBeLessThanOrEqual(MAX_CARRY);
  });

  it("is empty after Clear until a newer run settles", () => {
    const r = makeRecipe();
    settled(r.id, 1, "succeeded", { build: "1" }, "ok");
    clearCarry(r.id, Date.now() + 5000);
    expect(carryBlock(getRecipe(r.id)!)).toBe("");
  });
});
