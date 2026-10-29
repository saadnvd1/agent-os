import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  renderArtifactSnapshot,
  renderChatSnapshot,
  tooBig,
  MAX_SHARE_BYTES,
  withMetas,
} from "./render";
import { DARK, LIGHT } from "./styles";
import { noHits } from "./redact";
import type { Snapshot, SnapshotItem } from "./snapshot";

const item = (
  o: Partial<SnapshotItem> & { id: string; type: SnapshotItem["type"] }
): SnapshotItem => ({
  text: "",
  excerpt: "",
  tools: false,
  ...o,
});
const snap = (items: SnapshotItem[], toolsHidden = true): Snapshot => ({
  title: "A <b>chat</b>",
  items,
  toolsHidden,
  hits: noHits(),
});
const render = (s: Snapshot) =>
  renderChatSnapshot(s, { sharedAt: "2026-10-13T12:00:00.000Z" });

// Markup outside the artifact frames' srcdoc attributes.
const outsideFrames = (html: string) =>
  html.replace(/srcDoc="[^"]*"|srcdoc="[^"]*"/g, "");

describe("excerpt markers", () => {
  const items = [item({ id: "1", type: "user", text: "hi" })];
  it("says so at the top and bottom when the range was cut", () => {
    const html = render({ ...snap(items), cutBefore: true, cutAfter: true });
    const body = html.slice(html.indexOf("<main>"));
    expect(body.indexOf("Earlier messages not shared")).toBeLessThan(
      body.indexOf("hi")
    );
    expect(body.indexOf("Later messages not shared")).toBeGreaterThan(
      body.indexOf("hi")
    );
  });

  it("adds nothing for a whole chat", () => {
    const html = render({ ...snap(items), cutBefore: false, cutAfter: false });
    expect(html).not.toContain("messages not shared</div>");
    expect(render(snap(items))).not.toContain("not shared</div>");
  });

  it("shows only the side that was cut", () => {
    const html = render({ ...snap(items), cutAfter: true });
    expect(html).toContain("Later messages not shared");
    expect(html).not.toContain("Earlier messages not shared");
  });
});

describe("renderChatSnapshot", () => {
  const s = snap([
    item({ id: "1", type: "user", text: "<script>alert(1)</script> hello" }),
    item({
      id: "2",
      type: "assistant",
      text: "**bold** and\n\n```ts\nconst x = 1;\n```\n\n<script>alert(2)</script>\n\n[a link](https://example.com)",
    }),
    item({
      id: "3",
      type: "artifact",
      label: "Chart",
      html: "<script>1</script><p>hi</p>",
      height: 300,
    }),
    item({
      id: "4",
      type: "detail",
      label: "ls",
      text: "a <b> c",
      tools: true,
    }),
  ]);
  const html = render(s);

  it("is a complete page with the privacy metas, both colour schemes and the notice", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).toContain("Read-only snapshot; tool calls hidden");
    expect(html).toContain("<title>A &lt;b&gt;chat&lt;/b&gt;</title>");
  });

  it("has no script of its own and renders message text escaped", () => {
    const outside = outsideFrames(html);
    expect(outside).not.toMatch(/<script/i);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
  });

  it("renders markdown, highlighted code and safe links", () => {
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('class="token');
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
  });

  it("puts an artifact in a sandboxed frame without same-origin", () => {
    expect(html).toMatch(/<iframe[^>]*sandbox="allow-scripts"/);
    expect(html).not.toContain("allow-same-origin");
    expect(html).toContain("height:300px");
  });

  it("makes tool rows collapsible and requests nothing on load", () => {
    expect(html).toContain("<details");
    expect(outsideFrames(html)).not.toMatch(
      /<(img|link|script|embed|object)\b/i
    );
  });

  it("is deterministic and says when tool calls are shown", () => {
    expect(render(s)).toBe(html);
    expect(render(snap([], false))).not.toContain("tool calls hidden");
  });
});

describe("artifacts", () => {
  it("injects the metas into a head, an html without one, or a fragment", () => {
    for (const page of [
      "<html><head><title>t</title></head><body>x</body></html>",
      "<html><body>x</body></html>",
      "<p>x</p>",
    ]) {
      const out = renderArtifactSnapshot(page, "T");
      expect(out).toContain('name="robots" content="noindex,nofollow"');
      expect(out).toContain('name="referrer"');
      expect(out).toContain("x");
    }
    expect(withMetas("<head lang=a><title>t</title>")).toContain(
      "<head lang=a><meta"
    );
  });
});

describe("size", () => {
  it("flags a page over the cap", () => {
    expect(tooBig("a".repeat(MAX_SHARE_BYTES))).toBe(false);
    expect(tooBig("a".repeat(MAX_SHARE_BYTES + 1))).toBe(true);
  });
});

describe("theme", () => {
  it("uses the app's default light and dark colours", () => {
    const css = fs.readFileSync(
      path.join(process.cwd(), "styles/themes.css"),
      "utf8"
    );
    const block = (start: RegExp) => {
      const at = css.search(start);
      return css.slice(at, css.indexOf("}", at));
    };
    const value = (b: string, name: string) =>
      b.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();
    const light = block(/^\s*:root \{/m);
    const dark = block(/^\s*\.dark \{/m);
    for (const [name, v] of Object.entries(LIGHT))
      expect(value(light, name), name).toBe(v);
    for (const [name, v] of Object.entries(DARK))
      expect(value(dark, name), name).toBe(v);
  });
});
