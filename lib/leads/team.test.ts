import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/chat/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/runner")>()),
  sendChat: async () => {},
  stopChat: () => {},
}));

const { db } = await import("@/lib/db");
const { seedSession, seedWorkspace } =
  await import("@/lib/orchestrator/testing");
const { orchestratorOverview } = await import("@/lib/orchestrator/overview");
const { setExperiment } = await import("@/lib/experiments");
const home = await import("./home");

afterEach(() => setExperiment("leads", false));

const teamOf = (workspaceId: string) =>
  orchestratorOverview().find((o) => o.workspaceId === workspaceId)!.team;

describe("the sidebar's team", () => {
  it("is absent for a workspace without leads, Leads on or off", () => {
    const { workspace } = seedWorkspace();
    expect(teamOf(workspace.id)).toBeUndefined();
    setExperiment("leads", true);
    expect(teamOf(workspace.id)).toBeUndefined();
  });

  it("lists the chief, then Tech, Marketing and Product, only with Leads on", () => {
    const { workspace, app } = seedWorkspace();
    home.addLeads(workspace.id, ["product", "marketing"]);
    expect(teamOf(workspace.id)).toBeUndefined();

    setExperiment("leads", true);
    expect(teamOf(workspace.id)!.map((m) => [m.kind, m.title])).toEqual([
      ["tech", "Tech lead"],
      ["marketing", "Marketing lead"],
      ["product", "Product lead"],
    ]);

    const chief = seedSession({ projectId: app.id, name: "chief" });
    db.prepare(
      `UPDATE sessions SET role = 'chief', workspace_id = ? WHERE id = ?`
    ).run(workspace.id, chief);
    const team = teamOf(workspace.id)!;
    expect(team[0]).toEqual({
      kind: "chief",
      title: "Chief of staff",
      sessionId: chief,
    });
    expect(team.map((m) => m.kind)).toEqual([
      "chief",
      "tech",
      "marketing",
      "product",
    ]);
    expect(team[1].sessionId).toBe(home.getLead(workspace.id, "tech")!.id);
  });
});
