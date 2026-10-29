import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";

// DOMPurify reaches the app through mermaid; resolve it the way mermaid does.
const fromMermaid = createRequire(
  createRequire(import.meta.url).resolve("mermaid")
);
const createDOMPurify = fromMermaid("dompurify");

describe("dompurify (via mermaid)", () => {
  const purify = createDOMPurify(new JSDOM("").window);

  it("is at or past the patched version", () => {
    const [major, minor, patch] = purify.version.split(".").map(Number);
    expect(
      major > 3 || (major === 3 && (minor > 4 || (minor === 4 && patch >= 17)))
    ).toBe(true);
  });

  it("strips script tags and event handlers", () => {
    const out = purify.sanitize(
      '<p onclick="x()">hi</p><script>alert(1)</script><img src=x onerror="alert(1)"><a href="javascript:alert(1)">l</a>'
    );
    expect(out).not.toMatch(/<script|onerror|onclick|javascript:/i);
    expect(out).toContain("hi");
  });
});
