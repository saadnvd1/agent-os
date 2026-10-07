import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { cloneDeps, findNodeModules, lockfileHash } from "./clone";
import { sparePath } from "./spare";

let tmp: string, source: string, worktree: string, spares: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aos-clone-"));
  source = path.join(tmp, "source");
  worktree = path.join(tmp, "worktree");
  spares = path.join(tmp, "spare");
  for (const d of [source, worktree]) {
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, "package-lock.json"), '{"v":1}');
  }
  fs.mkdirSync(path.join(source, "node_modules", "dep"), { recursive: true });
  fs.writeFileSync(path.join(source, "node_modules", "dep", "index.js"), "1");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const darwin = async () => {
  const { refill, ...r } = await cloneDeps({
    sourcePath: source,
    worktreePath: worktree,
    spareRoot: spares,
    platform: "darwin",
  });
  await refill;
  return r;
};

describe("lockfileHash", () => {
  it("matches equal lockfiles and tells changed ones apart", async () => {
    expect(await lockfileHash(source)).toBe(await lockfileHash(worktree));
    fs.writeFileSync(path.join(worktree, "package-lock.json"), '{"v":2}');
    expect(await lockfileHash(source)).not.toBe(await lockfileHash(worktree));
    expect(await lockfileHash(spares)).toBeNull();
  });
});

describe("findNodeModules", () => {
  it("finds the root and workspace node_modules", async () => {
    fs.mkdirSync(path.join(source, "apps", "web", "node_modules"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(source, "web", "node_modules"), { recursive: true });
    fs.mkdirSync(path.join(source, ".hidden", "node_modules"), {
      recursive: true,
    });
    expect((await findNodeModules(source)).sort()).toEqual(
      ["apps/web/node_modules", "node_modules", "web/node_modules"].sort()
    );
  });
});

describe("cloneDeps", () => {
  it("installs instead off macOS", async () => {
    const r = await cloneDeps({
      sourcePath: source,
      worktreePath: worktree,
      spareRoot: spares,
      platform: "linux",
    });
    expect(r.ok).toBe(false);
    expect(fs.existsSync(path.join(worktree, "node_modules"))).toBe(false);
  });

  it.each([
    [
      "the worktree has no lockfile",
      () => fs.rmSync(path.join(worktree, "package-lock.json")),
      /lockfile differs/,
    ],
    [
      "the checkout has no lockfile",
      () => fs.rmSync(path.join(source, "package-lock.json")),
      /no lockfile/,
    ],
    [
      "the checkout has no node_modules",
      () => fs.rmSync(path.join(source, "node_modules"), { recursive: true }),
      /no node_modules/,
    ],
  ])("won't clone when %s", async (_, arrange, reason) => {
    arrange();
    const r = await darwin();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(reason);
    expect(fs.existsSync(path.join(worktree, "node_modules"))).toBe(false);
  });

  it("won't clone deps for a different lockfile", async () => {
    fs.writeFileSync(path.join(worktree, "package-lock.json"), '{"v":2}');
    const r = await darwin();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/lockfile differs/);
    expect(fs.existsSync(path.join(worktree, "node_modules"))).toBe(false);
  });

  it("clones the checkout's node_modules when the lockfiles match, and leaves a spare", async () => {
    const r = await darwin();
    expect(r).toEqual({
      ok: true,
      cloned: [{ rel: "node_modules", from: "clone" }],
    });
    expect(
      fs.readFileSync(
        path.join(worktree, "node_modules", "dep", "index.js"),
        "utf-8"
      )
    ).toBe("1");
    const spare = sparePath(
      spares,
      source,
      "node_modules",
      (await lockfileHash(source))!
    );
    expect(fs.existsSync(path.join(spare, "dep", "index.js"))).toBe(true);
  });

  it("replaces a clone a restart cut off, and leaves no partial behind", async () => {
    const partial = path.join(worktree, "node_modules.aos-partial");
    fs.mkdirSync(partial);
    fs.writeFileSync(path.join(partial, "junk"), "x");
    expect((await darwin()).ok).toBe(true);
    expect(
      fs.existsSync(path.join(worktree, "node_modules", "dep", "index.js"))
    ).toBe(true);
    expect(fs.existsSync(path.join(worktree, "node_modules", "junk"))).toBe(
      false
    );
    expect(fs.existsSync(partial)).toBe(false);
  });

  it("takes a waiting spare by rename", async () => {
    const spare = sparePath(
      spares,
      source,
      "node_modules",
      (await lockfileHash(source))!
    );
    fs.mkdirSync(path.join(spare, "from-spare"), { recursive: true });
    const r = await darwin();
    expect(r.cloned).toEqual([{ rel: "node_modules", from: "spare" }]);
    expect(
      fs.existsSync(path.join(worktree, "node_modules", "from-spare"))
    ).toBe(true);
  });

  it("skips a nested project whose own lockfile changed", async () => {
    for (const d of [source, worktree]) fs.mkdirSync(path.join(d, "mobile"));
    fs.mkdirSync(path.join(source, "mobile", "node_modules"));
    fs.writeFileSync(path.join(source, "mobile", "yarn.lock"), "a");
    fs.writeFileSync(path.join(worktree, "mobile", "yarn.lock"), "b");
    const r = await darwin();
    expect(r.cloned.map((c) => c.rel)).toEqual(["node_modules"]);
    expect(fs.existsSync(path.join(worktree, "mobile", "node_modules"))).toBe(
      false
    );
  });
});
