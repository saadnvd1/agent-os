import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { TRUST_HEADER } from "@/lib/security/auth";
import { seedWorkspace } from "./testing";
import { addRule, listRules } from "./rules";
import * as list from "@/app/api/workspaces/[id]/orchestrator/rules/route";
import * as one from "@/app/api/workspaces/[id]/orchestrator/rules/[ruleId]/route";

// From this machine (trusted), or from a device that can't approve.
const req = (method: string, body?: object, trusted = true) =>
  new NextRequest("http://localhost/api/x", {
    method,
    headers: {
      "content-type": "application/json",
      ...(trusted
        ? { [TRUST_HEADER]: "loopback" }
        : { [TRUST_HEADER]: "device" }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
const at = (id: string, ruleId?: string) => ({
  params: Promise.resolve({ id, ruleId: ruleId ?? "" }),
});

describe("the standing rules routes", () => {
  it("add, reword and remove a rule as Saad's from a place that can approve", async () => {
    const w = seedWorkspace().workspace.id;
    const added = await list.POST(
      req("POST", { text: "Never merge #111" }),
      at(w)
    );
    expect(added.status).toBe(200);
    const { rule } = await added.json();
    expect(rule.added_by).toBe("saad");
    const reworded = await one.PATCH(
      req("PATCH", { text: "Never merge #112" }),
      at(w, String(rule.id))
    );
    expect((await reworded.json()).rule.text).toBe("Never merge #112");
    expect(
      (await one.DELETE(req("DELETE"), at(w, String(rule.id)))).status
    ).toBe(200);
    expect(listRules(w)).toHaveLength(0);
  });

  it("refuse a device that can't approve, changing nothing", async () => {
    const w = seedWorkspace().workspace.id;
    const rule = addRule(w, "Never merge #98", "saad");
    const id = String(rule.id);
    expect(
      (await list.POST(req("POST", { text: "x" }, false), at(w))).status
    ).toBe(403);
    expect(
      (await one.PATCH(req("PATCH", { text: "x" }, false), at(w, id))).status
    ).toBe(403);
    expect(
      (await one.DELETE(req("DELETE", undefined, false), at(w, id))).status
    ).toBe(403);
    expect(listRules(w).map((r) => r.text)).toEqual(["Never merge #98"]);
  });

  it("refuse another workspace's rule and a malformed id", async () => {
    const a = seedWorkspace().workspace.id;
    const b = seedWorkspace().workspace.id;
    const rule = addRule(a, "Never merge #7", "saad");
    const id = String(rule.id);
    expect(
      (await one.PATCH(req("PATCH", { text: "x" }), at(b, id))).status
    ).toBe(400);
    expect((await one.DELETE(req("DELETE"), at(b, id))).status).toBe(400);
    for (const bad of ["abc", "0", "-1"])
      expect((await one.DELETE(req("DELETE"), at(a, bad))).status).toBe(400);
    expect(listRules(a).map((r) => r.text)).toEqual(["Never merge #7"]);
    expect((await list.POST(req("POST", {}), at(a))).status).toBe(400);
    expect((await list.GET(req("GET"), at("no-such"))).status).toBe(404);
  });
});
