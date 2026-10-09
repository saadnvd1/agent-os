import { randomUUID } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as demoRoute } from "@/app/api/demo/route";
import { db } from "./db";
import { raiseAsk } from "./orchestrator/asks";
import { orchestratorOverview } from "./orchestrator/overview";

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/demo", () => {
  it("says whether this server is a demo", async () => {
    expect(await (await demoRoute()).json()).toEqual({ demo: false });
    vi.stubEnv("AGENTOS_DEMO", "1");
    expect(await (await demoRoute()).json()).toEqual({ demo: true });
  });
});

describe("asks in the overview", () => {
  it("need a passkey to approve a gate, except in a demo", () => {
    const workspace = randomUUID();
    db.prepare(
      `INSERT INTO workspaces (id, name, sort_order) VALUES (?, 'W', 0)`
    ).run(workspace);
    const { ask } = raiseAsk({
      workspaceId: workspace,
      subject: `s-${randomUUID()}`,
      kind: "gate",
      title: "Merge it?",
    });
    const presence = () =>
      orchestratorOverview()
        .flatMap((w) => w.asks)
        .find((a) => a.id === ask.id)?.presence;
    expect(presence()).toBe(true);
    vi.stubEnv("AGENTOS_DEMO", "1");
    expect(presence()).toBe(false);
  });
});
