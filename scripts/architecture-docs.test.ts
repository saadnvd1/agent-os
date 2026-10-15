import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const dir = path.join(root, "docs/architecture");
const pages = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".html"))
  .sort();
const read = (f: string) => fs.readFileSync(path.join(dir, f), "utf8");

const cssOf = (html: string) =>
  /\/\* arch:start \*\/([\s\S]*?)\/\* arch:end \*\//.exec(html)?.[1];

/** Every href in a page, with the anchor and any query dropped. */
function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
}

describe("architecture pages", () => {
  it("has an index and one page per system, all listed in the README", () => {
    expect(pages).toContain("index.html");
    expect(pages.length).toBeGreaterThan(10);
    const readme = fs.readFileSync(path.join(dir, "README.md"), "utf8");
    const index = read("index.html");
    for (const page of pages) {
      expect(readme, `${page} in README.md`).toContain(`(${page})`);
      if (page !== "index.html")
        expect(index, `${page} linked from the index`).toContain(
          `href="${page}"`
        );
    }
  });

  it("links only to files that exist", () => {
    const problems: string[] = [];
    for (const page of pages) {
      for (const href of hrefs(read(page))) {
        if (/^https?:/.test(href)) {
          problems.push(`${page}: external link ${href}`);
          continue;
        }
        const file = href.split("#")[0];
        if (file && !fs.existsSync(path.resolve(dir, file)))
          problems.push(`${page}: ${href} does not exist`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("names key files that exist", () => {
    const problems: string[] = [];
    for (const page of pages) {
      for (const m of read(page).matchAll(
        /<code class="file">([^<]+)<\/code>/g
      )) {
        const rel = m[1].replace(/:\d+$/, "");
        if (!fs.existsSync(path.join(root, rel)))
          problems.push(`${page}: ${rel} does not exist`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("is self-contained: no scripts, no external resources", () => {
    const problems: string[] = [];
    for (const page of pages) {
      const html = read(page);
      if (/<script/i.test(html)) problems.push(`${page}: script`);
      if (/<link\b/i.test(html)) problems.push(`${page}: link tag`);
      if (/@import/i.test(html)) problems.push(`${page}: @import`);
      if (/(?:src|srcset)=|url\(\s*["']?https?:/i.test(html))
        problems.push(`${page}: external resource`);
    }
    expect(problems).toEqual([]);
  });

  it("reads on a phone and in both colour schemes", () => {
    for (const page of pages) {
      const html = read(page);
      expect(html, page).toContain('name="viewport"');
      expect(html, page).toContain('name="color-scheme"');
      expect(html, page).toMatch(/prefers-color-scheme:\s*dark/);
      expect(html, page).toMatch(/max-width:\s*720px/);
    }
  });

  it("shares one stylesheet block, byte for byte", () => {
    const want = cssOf(read("index.html"));
    expect(want).toBeTruthy();
    for (const page of pages) expect(cssOf(read(page)), page).toBe(want);
  });

  it("shows every merge gate the code has, and no other", () => {
    const code = fs.readFileSync(
      path.join(root, "lib/orchestrator/gates.ts"),
      "utf8"
    );
    const union = /export type GateName =([^;]+);/.exec(code)?.[1] ?? "";
    const names = [...union.matchAll(/"([\w-]+)"/g)].map((m) => m[1]).sort();
    expect(names.length).toBeGreaterThan(0);
    const drawn = [...read("gates.html").matchAll(/data-gate="([\w-]+)"/g)]
      .map((m) => m[1])
      .sort();
    expect(drawn).toEqual(names);
  });

  it("keeps out names and details that don't belong in a public repo", () => {
    for (const page of pages)
      expect(read(page), page).not.toMatch(
        /\/Users\/|\/home\/|\.ts\.net|\b\d{1,3}(\.\d{1,3}){3}\b|ghp_|\bsk-[A-Za-z0-9]{20}/
      );
  });
});
