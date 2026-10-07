import { describe, expect, it } from "vitest";
import { mcpView, toFileSuggestions } from "./claude";

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

describe("mcpView errors", () => {
  it("never shows a key from the server's URL", () => {
    const view = mcpView({
      name: "x",
      status: "failed",
      error:
        "SSE error: connect https://bob:hunter2@mcp.example.com/sse?api_key=abc123secret&x=1 failed\nretrying",
    });
    expect(view.error).not.toMatch(/hunter2|abc123secret|\n/);
    expect(view.error).toContain("mcp.example.com");
  });

  it("keeps an error short", () => {
    const view = mcpView({
      name: "x",
      status: "failed",
      error: "e".repeat(5000),
    });
    expect(view.error!.length).toBeLessThanOrEqual(300);
  });
});

describe("toFileSuggestions", () => {
  it("reads folders by their trailing slash, and files as they are", () => {
    expect(
      toFileSuggestions({
        suggestions: [{ path: "lib/chat/" }, { path: "lib/chat/queue.ts" }],
        cwd: "/repo",
      })
    ).toEqual([
      { path: "lib/chat", dir: true },
      { path: "lib/chat/queue.ts", dir: false },
    ]);
  });

  it("drops entries that aren't a path", () => {
    expect(
      toFileSuggestions({
        suggestions: [{ path: 5 }, { path: "" }, { path: "/" }, null, "x"],
      })
    ).toEqual([]);
  });

  it("is empty for an answer of another shape", () => {
    expect(toFileSuggestions(undefined)).toEqual([]);
    expect(toFileSuggestions({ suggestions: "a" })).toEqual([]);
  });
});
