import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { machineId } from "@/lib/claims/machine";
import { putSetting } from "@/lib/settings-store";
import { upsertLocal } from "@/lib/claims/store";
import { POST } from "./route";
import { DELETE } from "./[id]/route";

beforeEach(() => {
  db.prepare(`DELETE FROM work_claims`).run();
  putSetting("claims.share", null);
});

const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/claims", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );
const del = (id: string) =>
  DELETE(new Request("http://localhost"), { params: Promise.resolve({ id }) });

const ok = {
  remote: "https://github.com/acme/widgets.git",
  branch: "feature/search",
  goal: "Rework search",
  files: ["src/search.ts"],
};

describe("POST /api/claims", () => {
  it("registers, then reports an overlap with a task's claim", async () => {
    upsertLocal(
      { id: machineId(), name: "here" },
      {
        sessionId: "t1",
        sessionName: "Task",
        repo: "github.com/acme/widgets",
        branch: "task/search",
        base: "main",
        goal: "Search work",
        files: ["src/search.ts"],
        filesMore: 0,
        prUrl: null,
      }
    );
    const res = await post(ok);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.id).toMatch(/^o-/);
    expect(data.overlaps[0].strength).toBe("strong");
  });

  it("rejects a bad body, a non-remote and a custom id", async () => {
    expect((await post({ remote: 5 })).status).toBe(400);
    expect((await post({ ...ok, id: "s-abc" })).status).toBe(400);
    expect((await post({ ...ok, remote: "/srv/x" })).status).toBe(422);
  });

  it("is off when claims are", async () => {
    putSetting("claims.share", "off");
    expect((await post(ok)).status).toBe(409);
  });
});

describe("DELETE /api/claims/:id", () => {
  it("ends an outside claim but not a task's", async () => {
    upsertLocal(
      { id: machineId(), name: "here" },
      {
        sessionId: "t1",
        sessionName: "Task",
        repo: "github.com/acme/widgets",
        branch: "x",
        base: "main",
        goal: "Task",
        files: [],
        filesMore: 0,
        prUrl: null,
      }
    );
    expect((await del("s-t1")).status).toBe(403);
    const { id } = await (await post(ok)).json();
    expect((await del(id)).status).toBe(200);
    expect((await del("o-00000000-0000-0000-0000-000000000000")).status).toBe(
      200
    );
  });
});
