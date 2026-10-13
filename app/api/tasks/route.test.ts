import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

const post = (body: object) =>
  POST(
    new NextRequest("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify({ projectId: "none", prompt: "x", ...body }),
    })
  );

describe("POST /api/tasks with another agent's model", () => {
  it.each(["--allow-all-tools", "-m", "a b", "x\ny", "m".repeat(101), 7])(
    "refuses %j before anything is queued",
    async (model) => {
      const res = await post({ agent: "copilot", model });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Bad model name");
    }
  );
});
