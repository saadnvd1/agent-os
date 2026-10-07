import { describe, it, expect } from "vitest";
import { resolveRef, wasName, type Candidate } from "./resolve";

const c = (
  id: string,
  name: string,
  previousNames: string[] = [],
  projectName: string | null = "agent-os"
): Candidate => ({
  id,
  name,
  projectName,
  tmuxName: `claude-${id}`,
  previousNames,
});

const orchestrator = c("a1b2c3d4-0000", "orchestrator", ["Session 3"]);
const worker = c("f9e8d7c6-0000", "worker");

describe("resolveRef", () => {
  it("finds a session by its current name, project/name, id or tmux name", () => {
    for (const ref of [
      "orchestrator",
      "Agent-OS/Orchestrator",
      "a1b2c3d4-0000",
      "claude-a1b2c3d4-0000",
    ])
      expect(resolveRef(ref, [orchestrator, worker])).toEqual({
        ok: true,
        id: orchestrator.id,
        note: undefined,
      });
  });

  it("reaches a renamed session by its old name, and says so", () => {
    const r = resolveRef("session 3", [orchestrator, worker]);
    expect(r).toMatchObject({ ok: true, id: orchestrator.id });
    expect(r.ok && r.note).toBe('"session 3" was renamed to "orchestrator"');
    expect(
      resolveRef("agent-os/Session 3", [orchestrator, worker])
    ).toMatchObject({ ok: true, id: orchestrator.id });
  });

  it("lets a live session that has the name now win over the renamed one", () => {
    const fresh = c("11112222-0000", "Session 3");
    const r = resolveRef("Session 3", [orchestrator, fresh]);
    expect(r).toMatchObject({ ok: true, id: fresh.id });
    expect(r.ok && r.note).toContain(
      'used to be called that is "orchestrator"'
    );
  });

  it("accepts a unique id prefix of four or more characters", () => {
    expect(resolveRef("f9e8", [orchestrator, worker])).toMatchObject({
      ok: true,
      id: worker.id,
    });
    expect(resolveRef("f9e", [orchestrator, worker])).toMatchObject({
      ok: false,
      reason: "none",
    });
  });

  it("refuses an ambiguous name and lists every candidate", () => {
    const a = c("aaaa1111-0000", "fix", [], "dashboards");
    const b = c("bbbb2222-0000", "fix", [], "agent-os");
    const r = resolveRef("fix", [a, b]);
    expect(r).toMatchObject({ ok: false, reason: "ambiguous" });
    expect(!r.ok && r.error).toContain("dashboards/fix (id aaaa1111)");
    expect(!r.ok && r.error).toContain("agent-os/fix (id bbbb2222)");
  });

  it("refuses an old name two sessions both had", () => {
    const a = c("aaaa1111-0000", "one", ["Session 3"]);
    const b = c("bbbb2222-0000", "two", ["Session 3"]);
    expect(resolveRef("Session 3", [a, b])).toMatchObject({
      ok: false,
      reason: "ambiguous",
    });
  });

  it("refuses an ambiguous id prefix", () => {
    const a = c("abcd1111-0000", "one");
    const b = c("abcd2222-0000", "two");
    expect(resolveRef("abcd", [a, b])).toMatchObject({
      ok: false,
      reason: "ambiguous",
    });
  });

  it("says when nothing matches", () => {
    expect(resolveRef("nobody", [orchestrator])).toMatchObject({
      ok: false,
      reason: "none",
    });
    expect(resolveRef("  ", [orchestrator])).toMatchObject({ ok: false });
  });
});

describe("wasName", () => {
  it("is the latest name that isn't the current one", () => {
    expect(wasName(orchestrator)).toBe("Session 3");
    expect(wasName({ name: "a", previousNames: ["A", "b"] })).toBe("b");
    expect(wasName(worker)).toBeNull();
  });
});
