import { describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { getProject } from "@/lib/projects";
import { createWorkspace } from "@/lib/workspaces";
import { POST } from "./route";
import { tempDir } from "@/lib/test-temp";

const post = (body: object) =>
  POST({ json: async () => body } as unknown as NextRequest);

describe("POST /api/projects/init", () => {
  it("answers a folder that's already a project with 409 and it, and moves it on moveExisting", async () => {
    const a = createWorkspace("Route A");
    const b = createWorkspace("Route B");
    const dir = tempDir("aos-init-route-");

    const made = await post({ path: dir, workspaceId: a.id });
    expect(made.status).toBe(201);
    const { project } = await made.json();
    expect(getProject(project.id)?.workspace_id).toBe(a.id);

    const again = await post({ path: dir, workspaceId: b.id });
    expect(again.status).toBe(409);
    expect((await again.json()).existing).toEqual({
      id: project.id,
      name: project.name,
      workspaceId: a.id,
    });

    // Only a real true moves it.
    expect(
      (await post({ path: dir, workspaceId: b.id, moveExisting: "true" }))
        .status
    ).toBe(409);
    const moved = await post({
      path: dir,
      workspaceId: b.id,
      moveExisting: true,
    });
    expect(moved.status).toBe(201);
    expect((await moved.json()).project.id).toBe(project.id);
    expect(getProject(project.id)?.workspace_id).toBe(b.id);
  });
});
