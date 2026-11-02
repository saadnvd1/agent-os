import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// The owner's name comes from lib/owner.ts. A person's name written into a
// string a user or agent reads would show everyone else's installation that
// name. Comments and identifiers aren't looked at.
const ROOT = path.resolve(__dirname, "..");
const DIRS = ["lib", "app", "components", "hooks", "data"];
const NAME = /\bSaad\b/;
// "file:line" entries that may keep the name; expected to stay empty.
const ALLOWED: string[] = [];

function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "__fixtures__") continue;
      if (full.endsWith(path.join("lib", "db", "migrations"))) continue;
      sources(full, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

function hits(file: string): number[] {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];
  const visit = (node: ts.Node) => {
    const literal =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node);
    // "${owner()}" in plain quotes would print the placeholder itself.
    const plain =
      (ts.isStringLiteral(node) || ts.isJsxText(node)) &&
      /\$\{\s*(ownerUi|owner|Owner)\(/.test(node.getText(sf));
    if ((literal && NAME.test(node.getText(sf))) || plain) {
      const at = text.slice(0, node.getStart(sf)).split("\n").length;
      lines.push(at);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return lines;
}

describe("owner name", () => {
  it("is not written into any string, template or JSX text", () => {
    const found: string[] = [];
    for (const dir of DIRS)
      for (const file of sources(path.join(ROOT, dir)))
        for (const line of hits(file)) {
          const id = `${path.relative(ROOT, file)}:${line}`;
          if (!ALLOWED.includes(id)) found.push(id);
        }
    expect(found).toEqual([]);
  });
});
