import { describe, expect, it } from "vitest";
import { findRevisionOf, similarity, visibleText } from "./match";

const sentences = (n: number, salt = "") =>
  Array.from(
    { length: n },
    (_, i) => `Quarterly revenue line ${salt}${i} grew by region and product`
  ).join(". ");
const page = (body: string, css = "body{color:red}") =>
  `<html><head><style>${css}</style><script>var x=1</script></head><body><nav>Home Docs Pricing About Contact</nav><main>${body}</main></body></html>`;

describe("visibleText", () => {
  it("drops tags, scripts and styles and collapses whitespace", () => {
    expect(
      visibleText(
        "<style>a{}</style><p>Hi\n\n  <b>there</b></p><script>x()</script>"
      )
    ).toBe("hi there");
  });
});

describe("findRevisionOf", () => {
  it("matches a retitled revision with a few edits", () => {
    const v1 = page(`<h1>Old</h1><p>${sentences(8)}</p>`);
    const v2 = page(
      `<h1>New</h1><p>${sentences(8)}. One extra closing line here for you.</p>`,
      "body{color:blue}"
    );
    expect(findRevisionOf(v2, [{ key: "p1", html: v1 }])).toBe("p1");
  });

  it("treats a different page on the same template as new", () => {
    const a = page(`<p>${sentences(8, "a")}</p>`);
    const b = page(
      `<p>${sentences(8, "zz")}. Completely different story about trains.</p>`
    );
    expect(similarity(a, b)).toBeLessThan(0.6);
    expect(findRevisionOf(b, [{ key: "p1", html: a }])).toBeUndefined();
  });

  it("does not fuzzy match empty or tiny pages", () => {
    expect(
      findRevisionOf("<p>Hi</p>", [{ key: "p1", html: "<p>Hi</p>" }])
    ).toBeUndefined();
    expect(findRevisionOf("", [{ key: "p1", html: "" }])).toBeUndefined();
  });

  it("keeps a new page on a tie", () => {
    const v = page(`<p>${sentences(8)}</p>`);
    expect(
      findRevisionOf(v, [
        { key: "p1", html: v },
        { key: "p2", html: v },
      ])
    ).toBeUndefined();
  });

  it("only looks at the first 20 candidates", () => {
    const v = page(`<p>${sentences(8)}</p>`);
    const filler = Array.from({ length: 20 }, (_, i) => ({
      key: `f${i}`,
      html: page(`<p>${sentences(8, `q${i}`)}</p>`),
    }));
    expect(
      findRevisionOf(v, [...filler, { key: "late", html: v }])
    ).toBeUndefined();
  });
});
