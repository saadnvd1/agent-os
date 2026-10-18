import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createProject, getProject } from "@/lib/projects";
import { projectTier, setProjectTier } from "./index";
import { GET, PATCH } from "@/app/api/projects/[id]/route";

const patch = (id: string, body: unknown) =>
  PATCH(
    new Request("http://x/api/projects/" + id, {
      method: "PATCH",
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id }) }
  );

describe("project tier", () => {
  it("defaults to fast and round-trips through the API", async () => {
    const p = createProject({
      name: `tier-${Date.now()}`,
      workingDirectory: "/tmp/t",
    });
    expect(p.tier).toBe("fast");
    expect((await patch(p.id, { tier: "production" })).status).toBe(200);
    expect(projectTier(p.id)).toBe("production");
    const got = await GET(new Request("http://x") as never, {
      params: Promise.resolve({ id: p.id }),
    });
    expect((await got.json()).project.tier).toBe("production");
    setProjectTier(p.id, "fast");
    expect(getProject(p.id)?.tier).toBe("fast");
  });

  it("rejects an unknown tier and an unknown project", async () => {
    const p = createProject({
      name: `tier-bad-${Date.now()}`,
      workingDirectory: "/tmp/t",
    });
    expect((await patch(p.id, { tier: "staging" })).status).toBe(400);
    expect((await patch("nope", { tier: "fast" })).status).toBe(404);
    expect(() => setProjectTier("nope", "fast")).toThrow();
  });

  it("treats a missing project as production", () => {
    expect(projectTier(null)).toBe("production");
    expect(projectTier("nope")).toBe("production");
    void db;
  });
});
