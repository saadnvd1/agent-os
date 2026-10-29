import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

// Every link to a session goes through lib/session-url (sessionPath,
// sessionLink, hrefWithSession), so its shape lives in one place. A hand-made
// `/?session=` link here would skip the readable address.
const ROOTS = ["app", "components", "hooks", "lib", "stores", "data", "bin"];
const ALLOWED = new Set(["lib/session-url.ts"]);
const HAND_MADE = /\/\?session=(\$\{|["'`]\s*\+)/;

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "__fixtures__")
        sources(p, out);
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry.name) && !/\.test\./.test(p)) {
      out.push(p);
    }
  }
  return out;
}

describe("session links", () => {
  it("are built only by lib/session-url", () => {
    const root = path.resolve(__dirname, "..");
    const offenders = ROOTS.flatMap((r) =>
      fs.existsSync(path.join(root, r)) ? sources(path.join(root, r)) : []
    )
      .map((p) => path.relative(root, p))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) =>
        HAND_MADE.test(fs.readFileSync(path.join(root, rel), "utf8"))
      );
    expect(offenders).toEqual([]);
  });
});
