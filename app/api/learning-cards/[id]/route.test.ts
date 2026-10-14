import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { setExperiment } from "@/lib/experiments";
import { listRules } from "@/lib/orchestrator/rules";
import { clearCards, seedSession } from "@/lib/learning-cards/__fixtures__/db";
import { insertCard } from "@/lib/learning-cards/store";
import { POST } from "./route";

const post = (id: string, body: unknown) =>
  POST(
    new NextRequest(`http://localhost/api/learning-cards/${id}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );

function card() {
  const s = seedSession();
  const c = insertCard({
    sessionId: s.id,
    workspaceId: s.ws.id,
    kind: "lesson",
    destination: "rule",
    payload: { lesson: "Ask before deleting", destination: "rule", pairs: 1 },
  })!;
  return { s, c };
}

beforeEach(() => {
  clearCards();
  setExperiment("learning-cards", true);
});

describe("POST /api/learning-cards/[id]", () => {
  it("applies a card", async () => {
    const { s, c } = card();
    const res = await post(String(c.id), {
      action: "apply",
      lesson: "Ask first",
    });
    expect(res.status).toBe(200);
    expect(listRules(s.ws.id)[0].text).toBe("Ask first");
  });

  it("dismisses a card", async () => {
    const { s, c } = card();
    expect((await post(String(c.id), { action: "dismiss" })).status).toBe(200);
    expect(listRules(s.ws.id)).toEqual([]);
  });

  it("is 409 while off or when already decided, 400 for a bad id or action", async () => {
    const { c } = card();
    setExperiment("learning-cards", false);
    expect((await post(String(c.id), { action: "apply" })).status).toBe(409);
    setExperiment("learning-cards", true);
    expect((await post("abc", { action: "apply" })).status).toBe(400);
    expect((await post(String(c.id), { action: "nope" })).status).toBe(400);
    await post(String(c.id), { action: "dismiss" });
    expect((await post(String(c.id), { action: "apply" })).status).toBe(409);
  });
});
