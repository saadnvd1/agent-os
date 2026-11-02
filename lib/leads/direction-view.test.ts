import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fresh: string[] = [];
vi.mock("@/lib/chat/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/runner")>()),
  sendChat: async () => {},
  stopChat: () => {},
  chatStateNow: async () => null,
  freshStartChat: async (id: string) => {
    fresh.push(id);
    return "now";
  },
}));
vi.mock("@/lib/chat/worker/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/worker/client")>()),
  waitForExit: async () => {},
  removeStaleSocket: () => {},
}));

const { db, updateSessionRow } = await import("@/lib/db");
const { saveItem } = await import("@/lib/chat/store");
const { setExperiment } = await import("@/lib/experiments");
const { TRUST_HEADER } = await import("@/lib/security/auth");
const { seedSession, seedWorkspace } =
  await import("@/lib/orchestrator/testing");
const { ensureOrchestrator, getOrchestrator } =
  await import("@/lib/orchestrator/home");
const home = await import("./home");
const { adoptLead, confirmPins } = await import("./adopt");
const { runStandingTool } = await import("./tools");
const { currentDirection } = await import("./direction");
const { applyDirection, directionView, parseDirectionAction } =
  await import("./direction-view");
const route = await import("@/app/api/leads/direction/route");

beforeEach(() => {
  fresh.length = 0;
  db.prepare(`DELETE FROM settings WHERE key LIKE 'experiments.%'`).run();
  setExperiment("leads", true);
});

function say(sessionId: string, text: string, extra: object = {}): string {
  const id = `u-${randomUUID()}`;
  saveItem(sessionId, {
    id,
    kind: "user",
    text,
    createdAt: Date.now(),
    ...extra,
  } as never);
  return id;
}

function marketingLead() {
  const seeded = seedWorkspace();
  const w = seeded.workspace.id;
  home.addLeads(w, ["marketing"]);
  return { ...seeded, w, lead: home.getLead(w, "marketing")! };
}

describe("which chats have direction", () => {
  it("only a lead's, with Leads on", () => {
    const { w, app, lead } = marketingLead();
    expect(directionView(lead.id)).toMatchObject({
      workspaceId: w,
      kind: "marketing",
      title: "Marketing lead",
      pins: [],
      switchPending: false,
    });
    expect(directionView(getOrchestrator(w)!.id)?.kind).toBe("tech");
    expect(
      directionView(seedSession({ projectId: app.id, name: "plain" }))
    ).toBeNull();
    setExperiment("leads", false);
    expect(directionView(lead.id)).toBeNull();
  });

  it("not the orchestrator of a workspace without leads", () => {
    const { workspace } = seedWorkspace();
    expect(directionView(ensureOrchestrator(workspace.id).id)).toBeNull();
  });
});

describe("the owner's direction actions", () => {
  it("pins only his own words, once", () => {
    const { w, lead } = marketingLead();
    const mine = say(lead.id, "SEO-led growth, no launch posts");
    const peer = say(lead.id, "Ship it today", {
      origin: { kind: "peer", label: "someone" },
    });
    saveItem(lead.id, {
      id: "a-1",
      kind: "assistant",
      text: "I will launch",
      createdAt: Date.now(),
    } as never);
    expect(applyDirection(lead.id, { action: "pin", itemId: peer })).toEqual({
      error: expect.stringMatching(/own message/),
    });
    expect(
      applyDirection(lead.id, { action: "pin", itemId: "a-1" })
    ).toHaveProperty("error");
    expect(applyDirection(lead.id, { action: "pin", itemId: mine })).toBeNull();
    expect(applyDirection(lead.id, { action: "pin", itemId: mine })).toBeNull();
    expect(currentDirection(w, "marketing").map((p) => p.quote)).toEqual([
      "SEO-led growth, no launch posts",
    ]);
  });

  it("takes a pin down and keeps it in the history", () => {
    const { lead } = marketingLead();
    applyDirection(lead.id, { action: "pin", itemId: say(lead.id, "Weekly") });
    const [pin] = directionView(lead.id)!.pins;
    expect(applyDirection(lead.id, { action: "unpin", pinId: pin.id })).toBe(
      null
    );
    expect(
      applyDirection(lead.id, { action: "unpin", pinId: pin.id })
    ).toHaveProperty("error");
    const view = directionView(lead.id)!;
    expect(view.pins).toEqual([]);
    expect(view.history[0]).toMatchObject({ id: pin.id, quote: "Weekly" });
    expect(view.history[0].retiredAt).toBeTruthy();
  });

  it("answers one suggestion from its chip", async () => {
    const { w, lead } = marketingLead();
    const a = say(lead.id, "Free tier first");
    const b = say(lead.id, "Thanks");
    await runStandingTool(w, lead, "propose_pin", { item: a });
    await runStandingTool(w, lead, "propose_pin", { item: b });
    const [pa, pb] = directionView(lead.id)!.proposals;
    applyDirection(lead.id, {
      action: "proposal",
      proposalId: pb.id,
      pin: false,
    });
    applyDirection(lead.id, {
      action: "proposal",
      proposalId: pa.id,
      pin: true,
    });
    const view = directionView(lead.id)!;
    expect(view.proposals).toEqual([]);
    expect(view.pins.map((p) => p.quote)).toEqual(["Free tier first"]);
    expect(
      applyDirection(lead.id, {
        action: "proposal",
        proposalId: pa.id,
        pin: true,
      })
    ).toHaveProperty("error");
  });

  it("pinning a suggested message answers its suggestion", async () => {
    const { w, lead } = marketingLead();
    const a = say(lead.id, "Phone first");
    await runStandingTool(w, lead, "propose_pin", { item: a });
    applyDirection(lead.id, { action: "pin", itemId: a });
    expect(directionView(lead.id)!.proposals).toEqual([]);
  });

  it("parses only well-formed actions", () => {
    expect(parseDirectionAction({ action: "pin", itemId: "x" })).toEqual({
      action: "pin",
      itemId: "x",
    });
    expect(parseDirectionAction({ action: "unpin", pinId: "3" })).toBeNull();
    expect(
      parseDirectionAction({ action: "proposal", proposalId: 2 })
    ).toBeNull();
    expect(parseDirectionAction({ action: "drop" })).toBeNull();
  });
});

describe("an adopted lead's switch", () => {
  it("waits for the owner's tap, then is over", async () => {
    const { workspace, app } = seedWorkspace();
    const w = workspace.id;
    const id = seedSession({
      projectId: app.id,
      name: "planning",
      view: "chat",
    });
    updateSessionRow(db, id, { agent_type: "claude" });
    const item = say(id, "Post weekly, never daily");
    await adoptLead({ sessionId: id, workspaceId: w, kind: "marketing" });
    const lead = home.getLead(w, "marketing")!;
    expect(directionView(id)!.switchPending).toBe(true);
    await runStandingTool(w, lead, "propose_pin", { item });
    await runStandingTool(w, lead, "update_memo", { text: "Cadence: weekly" });
    const [p] = directionView(id)!.proposals;
    await confirmPins({
      workspaceId: w,
      kind: "marketing",
      confirm: [p.id],
      switchOver: true,
    });
    expect(fresh).toEqual([id]);
    const view = directionView(id)!;
    expect(view.switchPending).toBe(false);
    expect(view.memo?.text).toBe("Cadence: weekly");
    expect(view.pins.map((x) => x.quote)).toEqual(["Post weekly, never daily"]);
  });
});

describe("/api/leads/direction", () => {
  const post = (body: unknown, trust: string | null = "loopback") =>
    route.POST(
      new NextRequest("http://localhost/api/leads/direction", {
        method: "POST",
        body: JSON.stringify(body),
        headers: trust ? { [TRUST_HEADER]: trust } : {},
      })
    );

  it("reads a chat's direction, null for others", async () => {
    const { app, lead } = marketingLead();
    const get = (id: string) =>
      route
        .GET(
          new NextRequest(
            `http://localhost/api/leads/direction?sessionId=${id}`
          )
        )
        .then((r) => r.json());
    expect((await get(lead.id)).direction.kind).toBe("marketing");
    expect(
      (await get(seedSession({ projectId: app.id, name: "plain" }))).direction
    ).toBeNull();
  });

  it("pins for an approver only", async () => {
    const { lead } = marketingLead();
    const itemId = say(lead.id, "Readable screenshots");
    expect(
      (await post({ sessionId: lead.id, action: "pin", itemId }, null)).status
    ).toBe(403);
    expect((await post({ sessionId: lead.id, action: "pin" })).status).toBe(
      400
    );
    const res = await post({ sessionId: lead.id, action: "pin", itemId });
    expect(res.status).toBe(200);
    expect((await res.json()).direction.pins[0].quote).toBe(
      "Readable screenshots"
    );
  });

  it("refuses a chat without direction", async () => {
    const { app } = marketingLead();
    const id = seedSession({ projectId: app.id, name: "plain" });
    const res = await post({
      sessionId: id,
      action: "pin",
      itemId: say(id, "x"),
    });
    expect(res.status).toBe(400);
  });
});
