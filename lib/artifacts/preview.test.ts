import { describe, expect, it } from "vitest";
import { consoleMessage, PAGE_URL, routeRequest } from "./preview";

describe("the preview browser's requests", () => {
  it("serves the page from memory and anything else on its origin empty", () => {
    expect(routeRequest(PAGE_URL, "Document")).toBe("page");
    expect(routeRequest(PAGE_URL.replace("page.html", "favicon.ico"))).toBe(
      "empty"
    );
  });

  it("lets only http(s) subresources out", () => {
    expect(routeRequest("https://cdn.example.com/chart.js", "Script")).toBe(
      "continue"
    );
    for (const [url, type] of [
      ["file:///etc/passwd", "Image"],
      ["chrome://settings", "Other"],
      ["data:text/html,x", "Document"],
      ["https://example.com/", "Document"],
      ["ws://example.com/", "WebSocket"],
    ])
      expect(routeRequest(url, type), url).toBe("fail");
  });
});

describe("the preview's console", () => {
  it("reads console calls, exceptions and load errors", () => {
    expect(
      consoleMessage("Runtime.consoleAPICalled", {
        type: "warning",
        args: [
          { type: "string", value: "low" },
          { type: "number", value: 3 },
        ],
      })
    ).toEqual({ level: "warning", text: "low 3" });
    expect(
      consoleMessage("Runtime.exceptionThrown", {
        exceptionDetails: {
          text: "Uncaught",
          exception: { type: "object", description: "ReferenceError: x" },
        },
      })
    ).toEqual({ level: "error", text: "ReferenceError: x" });
    expect(
      consoleMessage("Log.entryAdded", {
        entry: { level: "error", text: "Failed", url: "https://a/b.js" },
      })
    ).toEqual({ level: "error", text: "Failed https://a/b.js" });
  });

  it("drops what isn't a message", () => {
    expect(
      consoleMessage("Runtime.consoleAPICalled", { type: "clear", args: [] })
    ).toBeUndefined();
    expect(
      consoleMessage("Log.entryAdded", {
        entry: { level: "verbose", text: "x" },
      })
    ).toBeUndefined();
    expect(consoleMessage("Page.loadEventFired", {})).toBeUndefined();
  });
});
