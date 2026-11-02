import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { TRUST_HEADER } from "@/lib/security/auth";
import { seedWorkspace } from "@/lib/orchestrator/testing";
import { addLeads } from "@/lib/leads/home";
import { getCharter } from "@/lib/leads/charters";
import { GET, PUT } from "./route";

const put = (body: unknown, trust: string | null = "loopback") =>
  PUT(
    new NextRequest("http://localhost/api/leads/charter", {
      method: "PUT",
      body: JSON.stringify(body),
      headers: trust ? { [TRUST_HEADER]: trust } : {},
    })
  );

const get = (workspaceId: string, kind: string) =>
  GET(
    new NextRequest(
      `http://localhost/api/leads/charter?workspaceId=${workspaceId}&kind=${kind}`
    )
  );

const edit = (workspaceId: string, over: object = {}) => ({
  workspaceId,
  kind: "marketing",
  title: "Growth lead",
  area: "SEO and docs",
  goal: "Steady organic growth",
  charter_md: "## Charter\n\nWrite guides.",
  ...over,
});

function seeded() {
  const { workspace } = seedWorkspace();
  addLeads(workspace.id, ["marketing"]);
  return workspace.id;
}

describe("/api/leads/charter", () => {
  it("reads and updates one lead's charter", async () => {
    const w = seeded();
    const before = (await (await get(w, "marketing")).json()).charter;
    expect(before.title).toBeTruthy();
    const res = await put(edit(w));
    expect(res.status).toBe(200);
    const { charter } = await res.json();
    expect(charter).toMatchObject({
      title: "Growth lead",
      area: "SEO and docs",
      goal: "Steady organic growth",
      charter_md: "## Charter\n\nWrite guides.",
    });
    expect((await (await get(w, "marketing")).json()).charter.title).toBe(
      "Growth lead"
    );
    expect(getCharter(w, "marketing")?.charterMd).toContain("Write guides");
  });

  it("refuses an empty title or charter and over-long text", async () => {
    const w = seeded();
    for (const over of [
      { title: "   " },
      { charter_md: "  \n" },
      { title: "x".repeat(121) },
      { charter_md: "x".repeat(20001) },
    ])
      expect((await put(edit(w, over))).status).toBe(400);
    expect((await put({ workspaceId: w })).status).toBe(400);
    expect(getCharter(w, "marketing")?.title).not.toBe("Growth lead");
  });

  it("needs an approver", async () => {
    const w = seeded();
    expect((await put(edit(w), null)).status).toBe(403);
  });

  it("is scoped to the workspace and never creates a charter", async () => {
    const a = seeded();
    const b = seeded();
    await put(edit(a));
    expect(getCharter(b, "marketing")?.title).not.toBe("Growth lead");
    expect((await put(edit(a, { kind: "design" }))).status).toBe(404);
    expect((await put(edit("nope"))).status).toBe(404);
    expect((await get(a, "design")).status).toBe(404);
    expect(getCharter("nope", "marketing")).toBeNull();
  });
});
