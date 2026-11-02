import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { TRUST_HEADER } from "@/lib/security/auth";
import { softAuthenticator } from "@/lib/security/soft-authenticator";
import { db } from "../db";
import { seedWorkspace } from "./testing";
import { addRule, listRules } from "./rules";
import * as optionsRoute from "@/app/api/presence/options/route";
import * as list from "@/app/api/workspaces/[id]/orchestrator/rules/route";
import * as one from "@/app/api/workspaces/[id]/orchestrator/rules/[ruleId]/route";

beforeEach(() => {
  db.exec(`DELETE FROM passkeys; DELETE FROM presence_challenges;
    DELETE FROM settings WHERE key = 'passkeys_bootstrapped_at';`);
});

// From this machine (trusted), or from a device that can't approve.
const req = (method: string, body?: object, trusted = true) =>
  new NextRequest("http://localhost:3011/api/x", {
    method,
    headers: {
      host: "localhost:3011",
      origin: "http://localhost:3011",
      "content-type": "application/json",
      [TRUST_HEADER]: trusted ? "loopback" : "device",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
const at = (id: string, ruleId?: string) => ({
  params: Promise.resolve({ id, ruleId: ruleId ?? "" }),
});

// the owner's passkey on a challenge bound to this workspace's rules.
async function proof(
  key: ReturnType<typeof softAuthenticator>,
  workspaceId: string
) {
  const res = await optionsRoute.POST(
    req("POST", { purpose: "rules", workspaceId })
  );
  const { options } = (await res.json()) as { options: { challenge: string } };
  return key.assert(options.challenge);
}

describe("the standing rules routes", () => {
  it("add, reword and remove a rule as the owner's, each with his passkey", async () => {
    const w = seedWorkspace().workspace.id;
    const key = softAuthenticator();
    key.register();
    const added = await list.POST(
      req("POST", { text: "Never merge #111", assertion: await proof(key, w) }),
      at(w)
    );
    expect(added.status).toBe(200);
    const { rule } = await added.json();
    expect(rule.added_by).toBe("saad");
    const id = String(rule.id);
    const reworded = await one.PATCH(
      req("PATCH", {
        text: "Never merge #112",
        assertion: await proof(key, w),
      }),
      at(w, id)
    );
    expect((await reworded.json()).rule.text).toBe("Never merge #112");
    const removed = await one.DELETE(
      req("DELETE", { assertion: await proof(key, w) }),
      at(w, id)
    );
    expect(removed.status).toBe(200);
    expect(listRules(w)).toHaveLength(0);
  });

  it("refuse a write from this machine with no passkey: any local process reaches the route", async () => {
    const w = seedWorkspace().workspace.id;
    softAuthenticator().register();
    const kept = addRule(w, "Hold #5 until CI is fixed", "orchestrator");
    const res = await list.POST(
      req("POST", { text: "Hold #5 until CI is fixed" }),
      at(w)
    );
    expect(res.status).toBe(403);
    // It stays the orchestrator's, fenced: not passed off as the owner's.
    expect(listRules(w)[0]).toMatchObject({
      id: kept.id,
      added_by: "orchestrator",
    });
    const id = String(kept.id);
    expect(
      (await one.PATCH(req("PATCH", { text: "x" }), at(w, id))).status
    ).toBe(403);
    expect((await one.DELETE(req("DELETE", {}), at(w, id))).status).toBe(403);
    expect(listRules(w)).toHaveLength(1);
  });

  it("refuse a passkey proof made for another workspace", async () => {
    const a = seedWorkspace().workspace.id;
    const b = seedWorkspace().workspace.id;
    const key = softAuthenticator();
    key.register();
    const res = await list.POST(
      req("POST", { text: "x", assertion: await proof(key, b) }),
      at(a)
    );
    expect(res.status).toBe(403);
    expect(listRules(a)).toHaveLength(0);
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
    expect((await one.DELETE(req("DELETE", {}, false), at(w, id))).status).toBe(
      403
    );
    expect(listRules(w).map((r) => r.text)).toEqual(["Never merge #98"]);
  });

  it("refuse another workspace's rule and a malformed id", async () => {
    const a = seedWorkspace().workspace.id;
    const b = seedWorkspace().workspace.id;
    const key = softAuthenticator();
    key.register();
    const rule = addRule(a, "Never merge #7", "saad");
    const id = String(rule.id);
    for (const res of [
      await one.PATCH(
        req("PATCH", { text: "x", assertion: await proof(key, b) }),
        at(b, id)
      ),
      await one.DELETE(
        req("DELETE", { assertion: await proof(key, b) }),
        at(b, id)
      ),
    ]) {
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/No rule/);
    }
    for (const bad of ["abc", "0", "-1", "1.5"]) {
      const res = await one.DELETE(req("DELETE", {}), at(a, bad));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Bad rule id" });
    }
    expect(listRules(a).map((r) => r.text)).toEqual(["Never merge #7"]);
    expect((await list.POST(req("POST", {}), at(a))).status).toBe(400);
    expect((await list.GET(req("GET"), at("no-such"))).status).toBe(404);
  });
});
