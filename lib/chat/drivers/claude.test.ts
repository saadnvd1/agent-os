import { describe, expect, it } from "vitest";
import { mcpView } from "./claude";

describe("mcpView", () => {
  it("keeps what /mcp shows: status, where it's from, tools", () => {
    expect(
      mcpView({
        name: "linear",
        status: "connected",
        scope: "user",
        source: "user",
        serverInfo: { name: "linear", version: "1.2.0" },
        tools: [
          { name: "list_issues", description: "List issues.\nMore detail" },
          { name: "get_issue" },
        ],
      })
    ).toEqual({
      name: "linear",
      status: "connected",
      scope: "user",
      version: "1.2.0",
      error: undefined,
      tools: [
        { name: "list_issues", description: "List issues." },
        { name: "get_issue", description: undefined },
      ],
    });
  });

  it("reports why a server failed", () => {
    expect(
      mcpView({ name: "x", status: "failed", error: "spawn ENOENT" })
    ).toMatchObject({ status: "failed", error: "spawn ENOENT", tools: [] });
  });
});
