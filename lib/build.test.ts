import { describe, expect, it } from "vitest";
import { buildId, isStaleWorker } from "./build";

describe("the build a process runs", () => {
  it("is fixed once and handed down through the environment", () => {
    delete process.env.AGENTOS_BUILD;
    const id = buildId();
    expect(id).toMatch(/^([0-9a-f]{40}|v.+|unknown)$/);
    expect(process.env.AGENTOS_BUILD).toBe(id);
    process.env.AGENTOS_BUILD = "from-the-server";
    expect(buildId()).toBe("from-the-server");
  });
});

describe("a stale chat worker", () => {
  it("is one on another build, and only retired while idle", () => {
    expect(isStaleWorker("old", "new", "idle")).toBe(true);
    // From before builds were reported at all.
    expect(isStaleWorker(undefined, "new", "idle")).toBe(true);
    // A running turn, or one waiting on an answer, is never cut.
    expect(isStaleWorker("old", "new", "running")).toBe(false);
    expect(isStaleWorker("old", "new", "waiting")).toBe(false);
    expect(isStaleWorker("new", "new", "idle")).toBe(false);
  });
});
