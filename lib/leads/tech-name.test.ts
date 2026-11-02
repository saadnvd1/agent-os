import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { matchesRef } from "@/lib/bus/format";
import { getOrchestrator } from "@/lib/orchestrator/home";
import { seedWorkspace } from "@/lib/orchestrator/testing";
import { putCharter } from "./charters";
import { addLeads, syncAllTechNames, syncTechName } from "./home";

const nameOf = (workspaceId: string) => getOrchestrator(workspaceId)!.name;

describe("the orchestrator's name", () => {
  it("is the Tech lead once leads are enabled, and stays one session", () => {
    const { workspace } = seedWorkspace();
    addLeads(workspace.id, []);
    expect(nameOf(workspace.id)).toBe(`${workspace.name} Tech lead`);
    const id = getOrchestrator(workspace.id)!.id;
    addLeads(workspace.id, ["marketing"]);
    expect(getOrchestrator(workspace.id)!.id).toBe(id);
  });

  it("goes back to orchestrator when leads are disabled", () => {
    const { workspace } = seedWorkspace();
    addLeads(workspace.id, []);
    db.prepare(`DELETE FROM workspace_leads WHERE workspace_id = ?`).run(
      workspace.id
    );
    syncTechName(workspace.id);
    expect(nameOf(workspace.id)).toBe(`${workspace.name} orchestrator`);
  });

  it("follows the tech charter's title", () => {
    const { workspace } = seedWorkspace();
    addLeads(workspace.id, []);
    putCharter({ workspaceId: workspace.id, leadKind: "tech", title: "CTO" });
    syncTechName(workspace.id);
    expect(nameOf(workspace.id)).toBe(`${workspace.name} CTO`);
  });

  it("is migrated once at startup, idempotently", () => {
    const { workspace } = seedWorkspace();
    addLeads(workspace.id, []);
    const id = getOrchestrator(workspace.id)!.id;
    db.prepare(`UPDATE sessions SET name = ? WHERE id = ?`).run(
      `${workspace.name} orchestrator`,
      id
    );
    const count = () =>
      (
        db
          .prepare(`SELECT COUNT(*) c FROM session_names WHERE session_id = ?`)
          .get(id) as { c: number }
      ).c;
    syncAllTechNames();
    expect(nameOf(workspace.id)).toBe(`${workspace.name} Tech lead`);
    const after = count();
    syncAllTechNames();
    expect(nameOf(workspace.id)).toBe(`${workspace.name} Tech lead`);
    expect(count()).toBe(after);
  });

  it("is still addressed by role, not by name", () => {
    const { workspace } = seedWorkspace();
    addLeads(workspace.id, []);
    const o = getOrchestrator(workspace.id)!;
    const s = {
      id: o.id,
      name: o.name,
      projectName: null,
      tmuxName: o.tmux_name,
      workspaceName: workspace.name,
      orchestrator: true,
    };
    expect(matchesRef(`${workspace.name}/orchestrator`, s)).toBe(true);
    expect(
      matchesRef(`${workspace.name}/tech`, { ...s, leadKind: "tech" })
    ).toBe(true);
  });
});
