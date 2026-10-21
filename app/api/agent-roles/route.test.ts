import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET, PUT } from "./route";
import { TRUST_HEADER } from "@/lib/security/auth";

const url = "http://localhost/api/agent-roles";
const put = (body: unknown, trusted = true) =>
  PUT(
    new NextRequest(url, {
      method: "PUT",
      body: JSON.stringify(body),
      headers: trusted ? { [TRUST_HEADER]: "loopback" } : {},
    })
  );
const get = (q = "") => GET(new NextRequest(`${url}${q}`));

beforeEach(() => {
  db.prepare(`DELETE FROM settings WHERE key LIKE 'models%'`).run();
});

describe("/api/agent-roles", () => {
  it("lists the four roles with the model in force", async () => {
    const { roles } = await (await get()).json();
    expect(roles.map((r: { id: string }) => r.id)).toEqual([
      "developer",
      "analyst",
      "reviewer",
      "supervisor",
    ]);
    expect(roles[0].binding).toMatchObject({ source: "default" });
  });

  it("saves a role and shows it back", async () => {
    const res = await put({
      scope: "settings",
      roles: { analyze: "anthropic/claude-sonnet-5-5" },
    });
    expect(res.status).toBe(200);
    const { roles } = await res.json();
    expect(roles.find((r: { id: string }) => r.id === "analyst")).toMatchObject(
      {
        value: "anthropic/claude-sonnet-5-5",
        binding: { source: "settings" },
      }
    );
  });

  it("refuses a request that isn't from this machine or the tailnet", async () => {
    expect((await put({ scope: "settings", roles: {} }, false)).status).toBe(
      403
    );
  });

  it("refuses a Pi model for a role that can't run it", async () => {
    const res = await put({
      scope: "settings",
      roles: { orchestrator: "pi/local/qwen3-27b" },
    });
    expect(res.status).toBe(400);
  });

  it("404s an unknown project and 400s a bad scope", async () => {
    expect((await get("?scope=project&id=nope")).status).toBe(404);
    expect((await get("?scope=galaxy")).status).toBe(400);
  });
});
