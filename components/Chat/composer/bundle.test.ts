import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The chat loads without the editor: Composer.tsx may only reach it through
// next/dynamic, so TipTap, lowlight and mdast stay out of the main bundle.
describe("Composer.tsx", () => {
  const source = readFileSync(join(__dirname, "..", "Composer.tsx"), "utf8");
  const imports = [
    ...source.matchAll(/^import (?!type )[^;]*from "([^"]+)"/gm),
  ].map((m) => m[1]);

  it("imports nothing heavy statically", () => {
    for (const path of imports)
      expect(path).not.toMatch(
        /tiptap|lowlight|mdast|micromark|ComposerBody|markdown/
      );
  });

  it("loads the body with next/dynamic", () => {
    expect(imports).toContain("next/dynamic");
    expect(source).toMatch(/import\("\.\/composer\/ComposerBody"\)/);
  });
});
