import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createProject } from "@/lib/projects";
import { POST } from "@/app/api/tasks/route";

const count = () =>
  (db.prepare(`SELECT COUNT(*) AS n FROM sessions`).get() as { n: number }).n;

describe("POST /api/tasks with a machine", () => {
  it("refuses a machine other than the project's, starting nothing", async () => {
    const project = createProject({
      name: "here",
      workingDirectory: "/tmp",
    });
    const before = count();
    const res = await POST(
      new Request("http://localhost/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          prompt: "Do it",
          hostId: "devbox",
        }),
      }) as never
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/where their project lives/);
    expect(count()).toBe(before);
  });
});
