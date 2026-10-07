import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pruneSpares, replenishSpare, sparePath, takeSpare } from "./spare";

let tmp: string, source: string, root: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aos-spare-"));
  source = path.join(tmp, "source");
  root = path.join(tmp, "spare");
  fs.mkdirSync(path.join(source, "node_modules", "dep"), { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("spares", () => {
  it("makes one, then takes it exactly once", async () => {
    expect(await replenishSpare(root, source, "node_modules", "aaa")).toBe(
      "made"
    );
    expect(await replenishSpare(root, source, "node_modules", "aaa")).toBe(
      "exists"
    );
    const spare = sparePath(root, source, "node_modules", "aaa");
    expect(fs.existsSync(path.join(spare, "dep"))).toBe(true);
    expect(await takeSpare(spare, path.join(tmp, "a"))).toBe(true);
    expect(await takeSpare(spare, path.join(tmp, "b"))).toBe(false);
  });

  it("prunes spares for an old lockfile and abandoned builds", async () => {
    const old = sparePath(root, source, "node_modules", "old");
    const other = sparePath(
      root,
      path.join(tmp, "other"),
      "node_modules",
      "old"
    );
    const fresh = `${sparePath(root, source, "node_modules", "new")}.1-1`;
    const abandoned = `${sparePath(root, source, "node_modules", "new")}.2-2`;
    for (const d of [old, other, fresh, abandoned])
      fs.mkdirSync(d, { recursive: true });
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(abandoned, hourAgo, hourAgo);

    expect(await replenishSpare(root, source, "node_modules", "new")).toBe(
      "made"
    );
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(abandoned)).toBe(false);
    // Another checkout's spare, and a build still under way, stay.
    expect(fs.existsSync(other)).toBe(true);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(sparePath(root, source, "node_modules", "new"))).toBe(
      true
    );
  });

  it("prunes nothing in a root that doesn't exist yet", async () => {
    expect(
      await pruneSpares(path.join(tmp, "none"), source, "node_modules", "x")
    ).toEqual([]);
  });
});
