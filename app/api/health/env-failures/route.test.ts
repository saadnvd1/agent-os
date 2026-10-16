import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { recordHit } from "@/lib/health/env/recordHit";
import { resetEnv, seedSession } from "@/lib/health/env/helpers.test-util";
import { GET, PATCH } from "./route";

const get = (qs = "") =>
  GET(new NextRequest(`http://localhost/api/health/env-failures${qs}`));
const patch = (body: unknown) =>
  PATCH(
    new NextRequest("http://localhost/api/health/env-failures", {
      method: "PATCH",
      body: JSON.stringify(body),
    })
  );

beforeEach(resetEnv);

describe("/api/health/env-failures", () => {
  it("counts sessions per class and lists a class's sessions", async () => {
    seedSession("env-a");
    recordHit(
      "env-a",
      "i",
      { class: "python-not-found", line: "l", command: "python x" },
      Date.now()
    );
    const summary = await (await get()).json();
    const c = summary.classes.find(
      (k: { id: string }) => k.id === "python-not-found"
    );
    expect([c.sessions7, c.sessions30]).toEqual([1, 1]);
    const list = await (await get("?class=python-not-found")).json();
    expect(
      list.sessions.map((s: { sessionId: string }) => s.sessionId)
    ).toEqual(["env-a"]);
  });

  it("refuses an unknown class or days", async () => {
    expect((await get("?class=nope")).status).toBe(400);
    expect((await get("?days=0")).status).toBe(400);
  });

  it("sets and clears this machine's fix text", async () => {
    expect(
      (await patch({ class: "python-not-found", fix: "Use uv." })).status
    ).toBe(200);
    let s = await (await get()).json();
    let c = s.classes.find((k: { id: string }) => k.id === "python-not-found");
    expect([c.fix, c.fixOverridden]).toEqual(["Use uv.", true]);
    await patch({ class: "python-not-found", fix: null });
    s = await (await get()).json();
    c = s.classes.find((k: { id: string }) => k.id === "python-not-found");
    expect(c.fixOverridden).toBe(false);
    expect((await patch({ class: "nope", fix: "x" })).status).toBe(404);
    expect(
      (await patch({ class: "python-not-found", fix: "x".repeat(501) })).status
    ).toBe(400);
  });
});
