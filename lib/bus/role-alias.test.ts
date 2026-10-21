import { describe, expect, it } from "vitest";
import type { Session } from "../db";
import { resolveRoleAlias, roleAliasOf } from "./role-alias";

const s = (over: Partial<Session> & { id: string; name: string }) =>
  ({
    role: null,
    agent_role: null,
    crew_id: null,
    project_id: "p1",
    workspace_id: null,
    ...over,
  }) as unknown as Session;

describe("@role names", () => {
  it("reads only the four roles", () => {
    expect(roleAliasOf("@Reviewer")).toBe("reviewer");
    expect(roleAliasOf(" @developer ")).toBe("developer");
    expect(roleAliasOf("@boss")).toBeNull();
    expect(roleAliasOf("reviewer")).toBeNull();
    expect(roleAliasOf("agent-os/@reviewer")).toBeNull();
  });

  const dev = s({
    id: "d1",
    name: "dev",
    agent_role: "developer",
    crew_id: "d1",
  });
  const rev = s({
    id: "r1",
    name: "rev",
    agent_role: "reviewer",
    crew_id: "d1",
  });
  const other = s({
    id: "r2",
    name: "rev2",
    agent_role: "reviewer",
    crew_id: "x9",
  });

  it("finds the role in the caller's crew before the project", () => {
    const r = resolveRoleAlias("reviewer", [dev, rev, other], dev);
    expect(r).toMatchObject({ ok: true, session: { id: "r1" } });
  });

  it("falls back to the project when the caller has no crew", () => {
    const loner = s({ id: "l1", name: "loner" });
    expect(resolveRoleAlias("developer", [dev, loner], loner)).toMatchObject({
      ok: true,
      session: { id: "d1" },
    });
  });

  it("refuses, naming them, when more than one fits", () => {
    const loner = s({ id: "l1", name: "loner" });
    const r = resolveRoleAlias("reviewer", [rev, other, loner], loner);
    expect(r).toMatchObject({ ok: false, none: false });
    expect(!r.ok && r.error).toMatch(
      /matches 2 sessions: rev \(id r1\), rev2 \(id r2\)/
    );
  });

  it("never answers with the caller itself", () => {
    expect(resolveRoleAlias("developer", [dev], dev)).toMatchObject({
      ok: false,
      none: true,
    });
  });

  it("sends @supervisor to the workspace's orchestrator when nobody holds the role", () => {
    const orch = s({
      id: "o1",
      name: "orch",
      role: "orchestrator",
      workspace_id: "w1",
      project_id: null,
    });
    const caller = s({ id: "c1", name: "c", workspace_id: "w1" });
    expect(
      resolveRoleAlias("supervisor", [orch, caller], caller)
    ).toMatchObject({
      ok: true,
      session: { id: "o1" },
    });
    expect(
      resolveRoleAlias(
        "supervisor",
        [orch, caller],
        s({ id: "z", name: "z", workspace_id: "w2" })
      )
    ).toMatchObject({ ok: false, none: true });
  });
});
