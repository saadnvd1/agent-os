import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { seedSession, seedWorkspace } from "../orchestrator/testing";
import { PROVIDER_PRESETS } from "./providers";

const models = await import("@/app/api/models/route");
const workspaceModels = await import("@/app/api/workspaces/[id]/models/route");
const taskModel = await import("@/app/api/tasks/[id]/model/route");
const test = await import("@/app/api/models/test/route");
const compare = await import("@/app/api/usage/compare/route");

const req = (url: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    ...(body !== undefined && {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  db.prepare(`DELETE FROM settings WHERE key LIKE 'models%'`).run();
});

describe("model routing routes", () => {
  it("saves role models and providers, and refuses a bad one", async () => {
    const deepseek = {
      ...PROVIDER_PRESETS.find((p) => p.id === "deepseek")!,
      auth: { kind: "tokenvault", project: "deepseek" },
      enabled: true,
    };
    const res = await models.PUT(
      req("/api/models", "PUT", {
        roles: { review: "deepseek/deepseek-v4-pro" },
        providers: [deepseek],
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.effective.roles.review).toBe("deepseek/deepseek-v4-pro");
    expect(body.defaults.plan).toBe("anthropic/claude-opus-5-5");

    const bad = await models.PUT(
      req("/api/models", "PUT", { roles: { review: "nope" } })
    );
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/provider\/model/);
  });

  it("keeps a workspace's own role models", async () => {
    const { workspace } = seedWorkspace();
    const put = await workspaceModels.PUT(
      req("", "PUT", { roles: { implement: "anthropic/claude-opus-5-5" } }),
      params(workspace.id)
    );
    expect(await put.json()).toEqual({
      roles: { implement: "anthropic/claude-opus-5-5" },
    });
    const missing = await workspaceModels.PUT(
      req("", "PUT", { roles: {} }),
      params("no-such-workspace")
    );
    expect(missing.status).toBe(404);
  });

  it("refuses to resume what isn't a running task, or on no model", async () => {
    const { app } = seedWorkspace();
    const chat = seedSession({ projectId: app.id, name: "chat" });
    const res = await taskModel.POST(
      req("", "POST", { model: "anthropic/claude-sonnet-5-5" }),
      params(chat)
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("No such task");
  });

  it("tests a provider that has no key without reaching it", async () => {
    const res = await test.POST(req("", "POST", { provider: "zai" }));
    expect(await res.json()).toMatchObject({
      ok: false,
      message: "Set its base URL and key",
    });
    expect((await test.POST(req("", "POST", {}))).status).toBe(400);
  });

  it("compares over a range, and refuses one that ends before it starts", async () => {
    const ok = await compare.GET(req("/api/usage/compare?days=7"));
    const body = await ok.json();
    expect(body.to - body.from).toBe(7 * 24 * 3600 * 1000);
    expect(Array.isArray(body.cohorts)).toBe(true);
    const bad = await compare.GET(req("/api/usage/compare?from=10&to=5"));
    expect(bad.status).toBe(400);
  });
});
