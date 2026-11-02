import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { setExperiment } from "@/lib/experiments";
import { TRUST_HEADER } from "@/lib/security/auth";
import { seedWorkspace } from "@/lib/orchestrator/testing";
import { GET, POST } from "./route";
import * as adopt from "./adopt/route";
import * as proposals from "./proposals/route";
import * as setup from "./setup/route";

const post = (
  handler: (r: NextRequest) => Promise<Response>,
  path: string,
  body: unknown,
  trust: string | null = "loopback"
) =>
  handler(
    new NextRequest(`http://localhost/api/leads${path}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: trust ? { [TRUST_HEADER]: trust } : {},
    })
  );

beforeEach(() => {
  db.prepare(`DELETE FROM settings WHERE key LIKE 'experiments.%'`).run();
});

describe("/api/leads", () => {
  it("refuses while Leads is off, and without an approver", async () => {
    const { workspace } = seedWorkspace();
    const body = { workspaceId: workspace.id, kinds: ["marketing"] };
    expect((await post(POST, "", body)).status).toBe(409);
    expect(
      (
        await post(adopt.POST, "/adopt", {
          ...body,
          sessionId: "x",
          kind: "marketing",
        })
      ).status
    ).toBe(409);
    setExperiment("leads", true);
    expect((await post(POST, "", body, null)).status).toBe(403);
    expect((await post(proposals.POST, "/proposals", body, null)).status).toBe(
      403
    );
  });

  it("adds leads and lists them", async () => {
    setExperiment("leads", true);
    const { workspace } = seedWorkspace();
    const res = await post(POST, "", {
      workspaceId: workspace.id,
      kinds: ["marketing"],
    });
    expect(res.status).toBe(200);
    expect(
      (await res.json()).leads.map((l: { kind: string }) => l.kind)
    ).toEqual(["tech", "marketing"]);
    const list = await (
      await GET(new NextRequest("http://localhost/api/leads"))
    ).json();
    expect(list.enabled).toBe(true);
    expect(
      list.workspaces.map((w: { workspaceId: string }) => w.workspaceId)
    ).toContain(workspace.id);
    const bad = await post(POST, "", {
      workspaceId: workspace.id,
      kinds: ["No Way"],
    });
    expect(bad.status).toBe(400);
    expect(
      (await post(POST, "", { workspaceId: "nope", kinds: [] })).status
    ).toBe(404);
  });

  it("lists a lead's open proposals and refuses an unknown lead's", async () => {
    setExperiment("leads", true);
    const { workspace } = seedWorkspace();
    await post(POST, "", { workspaceId: workspace.id, kinds: ["product"] });
    const res = await proposals.GET(
      new NextRequest(
        `http://localhost/api/leads/proposals?workspaceId=${workspace.id}&kind=product`
      )
    );
    expect((await res.json()).proposals).toEqual([]);
    const none = await post(proposals.POST, "/proposals", {
      workspaceId: workspace.id,
      kind: "design",
      confirm: [],
    });
    expect(none.status).toBe(400);
  });
});

describe("/api/leads/setup", () => {
  const get = (q: string) =>
    setup.GET(new NextRequest(`http://localhost/api/leads/setup${q}`));

  it("answers the sheet's view, and refuses a bad or unknown workspace", async () => {
    const { workspace } = seedWorkspace();
    const res = await get(`?workspaceId=${workspace.id}`);
    expect(res.status).toBe(200);
    const { setup: view } = await res.json();
    expect(view.workspaceId).toBe(workspace.id);
    expect(view.choices.map((c: { kind: string }) => c.kind)).toEqual([
      "tech",
      "marketing",
      "product",
    ]);
    expect((await get("")).status).toBe(400);
    expect((await get("?workspaceId=nope")).status).toBe(404);
  });
});
