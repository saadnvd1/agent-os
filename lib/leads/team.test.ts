import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/chat/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/runner")>()),
  sendChat: async () => {},
  stopChat: () => {},
}));

const { seedWorkspace } = await import("@/lib/orchestrator/testing");
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
    const { workspace } = seedWorkspace();
    home.addLeads(workspace.id, ["product", "marketing"]);
    expect(teamOf(workspace.id)).toBeUndefined();

    setExperiment("leads", true);
    const team = teamOf(workspace.id)!;
    expect(team.map((m) => [m.kind, m.title])).toEqual([
      ["chief", "Chief of staff"],
      ["tech", "Tech lead"],
      ["marketing", "Marketing lead"],
      ["product", "Product lead"],
    ]);
    // Add leads made the chief; it's the workspace's only one.
    expect(team[0].sessionId).toBe(home.getChief(workspace.id)!.id);
    expect(team[1].sessionId).toBe(home.getLead(workspace.id, "tech")!.id);
  });
});
