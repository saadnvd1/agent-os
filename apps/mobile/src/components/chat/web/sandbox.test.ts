import { describe, expect, it } from "vitest";
import { mermaidHtml, navigation, reportedHeight } from "./sandbox";

describe("reportedHeight", () => {
  it("takes a number and clamps it", () => {
    expect(
      reportedHeight(JSON.stringify({ agentosArtifactHeight: 300.4 }), 720)
    ).toBe(300);
    expect(
      reportedHeight(JSON.stringify({ agentosArtifactHeight: 10 }), 720)
    ).toBe(80);
    expect(
      reportedHeight(JSON.stringify({ agentosArtifactHeight: 99999 }), 720)
    ).toBe(720);
  });

  it("ignores anything else a page sends", () => {
    expect(reportedHeight("not json", 720)).toBeNull();
    expect(
      reportedHeight(JSON.stringify({ agentosArtifactHeight: "300" }), 720)
    ).toBeNull();
    expect(
      reportedHeight(JSON.stringify({ agentosArtifactHeight: Infinity }), 720)
    ).toBeNull();
    expect(reportedHeight("null", 720)).toBeNull();
  });
});

describe("navigation", () => {
  const home = "http://100.64.0.1:3011/api/artifacts/a1";
  it("loads the page itself and its frames", () => {
    expect(navigation({ url: home }, home)).toBe("load");
    expect(
      navigation({ url: "https://x.test/frame", isTopFrame: false }, home)
    ).toBe("load");
  });

  it("sends a tapped link to Safari and blocks script navigation", () => {
    expect(
      navigation({ url: "https://example.com", navigationType: "click" }, home)
    ).toBe("external");
    expect(
      navigation({ url: "https://evil.test", navigationType: "other" }, home)
    ).toBe("block");
    expect(
      navigation(
        { url: "http://100.64.0.1:3011/api/sessions", navigationType: "other" },
        home
      )
    ).toBe("block");
    expect(
      navigation({ url: "javascript:alert(1)", navigationType: "click" }, home)
    ).toBe("block");
    expect(navigation({ url: "tel:123", navigationType: "click" }, home)).toBe(
      "block"
    );
  });
});

describe("mermaidHtml", () => {
  it("embeds the source so it can't close the script", () => {
    const html = mermaidHtml(
      "graph TD; A-->B</script><script>alert(1)</script>",
      true
    );
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("\\u003c/script>");
    expect(html).toContain('securityLevel: "strict"');
  });

  it("locks the page down: no fetches, no frames, no remote scripts", () => {
    const html = mermaidHtml("graph TD; A-->B", false);
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("frame-src 'none'");
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toContain("jsdelivr");
  });
});
