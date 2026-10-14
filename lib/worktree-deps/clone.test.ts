import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  cloneDeps,
  findNodeModules,
  lockfileHash,
  nodeModulesMatchLock,
} from "./clone";
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
  it("installs instead when no fast copy works", async () => {
    const r = await cloneDeps({
      sourcePath: source,
      worktreePath: worktree,
      spareRoot: spares,
      mode: null,
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
    expect(r).toMatchObject({
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

describe("cloneDeps with agentos.json's clone", () => {
  const declared = async (only: string[]) => {
    const { refill, ...r } = await cloneDeps({
      sourcePath: source,
      worktreePath: worktree,
      spareRoot: spares,
      platform: "darwin",
      only,
    });
    await refill;
    return r;
  };

  it("still refuses a declared root node_modules for a different lockfile", async () => {
    fs.writeFileSync(path.join(worktree, "package-lock.json"), '{"v":2}');
    const r = await declared(["node_modules"]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/lockfile differs/);
    expect(fs.existsSync(path.join(worktree, "node_modules"))).toBe(false);
  });

  it("clones only what is declared", async () => {
    fs.mkdirSync(path.join(source, ".venv", "bin"), { recursive: true });
    fs.writeFileSync(path.join(source, ".venv", "bin", "python"), "py");
    const r = await declared([".venv"]);
    expect(r).toMatchObject({
      ok: true,
      cloned: [{ rel: ".venv", from: "clone" }],
    });
    expect(
      fs.readFileSync(path.join(worktree, ".venv", "bin", "python"), "utf8")
    ).toBe("py");
    expect(fs.existsSync(path.join(worktree, "node_modules"))).toBe(false);
  });

  it("clones a declared folder with no lockfile anywhere", async () => {
    fs.rmSync(path.join(source, "package-lock.json"));
    fs.rmSync(path.join(worktree, "package-lock.json"));
    fs.mkdirSync(path.join(source, "vendor", "bundle"), { recursive: true });
    fs.writeFileSync(path.join(source, "vendor", "bundle", "x"), "1");
    fs.mkdirSync(path.join(worktree, "vendor"));
    const r = await declared(["vendor/bundle/"]);
    expect(r).toMatchObject({
      ok: true,
      cloned: [{ rel: "vendor/bundle", from: "clone" }],
    });
  });

  it("skips a declared path the checkout doesn't have", async () => {
    expect(await declared(["missing"])).toMatchObject({ ok: true, cloned: [] });
  });
});

describe("cloneDeps with a hardlinked store (Linux without reflinks)", () => {
  const link = async () => {
    const { refill, ...r } = await cloneDeps({
      sourcePath: source,
      worktreePath: worktree,
      spareRoot: spares,
      storeRoot: path.join(tmp, "store"),
      mode: "hardlink",
    });
    await refill;
    return r;
  };
  const ino = (...p: string[]) => fs.statSync(path.join(...p)).ino;

  it("links node_modules from the store, never from the checkout", async () => {
    fs.writeFileSync(
      path.join(source, "node_modules", ".package-lock.json"),
      "{}"
    );
    const r = await link();
    expect(r).toMatchObject({ ok: true, mode: "hardlink" });
    const dep = ["node_modules", "dep", "index.js"];
    expect(ino(worktree, ...dep)).not.toBe(ino(source, ...dep));
    const stored = fs
      .readdirSync(path.join(tmp, "store"))
      .map((n) => path.join(tmp, "store", n, "dep", "index.js"));
    expect(stored).toHaveLength(1);
    expect(ino(worktree, ...dep)).toBe(fs.statSync(stored[0]).ino);
    // The files tools rewrite are the worktree's own.
    fs.appendFileSync(
      path.join(worktree, "node_modules", ".package-lock.json"),
      "x"
    );
    expect(
      fs.readFileSync(
        path.join(source, "node_modules", ".package-lock.json"),
        "utf-8"
      )
    ).toBe("{}");
  });

  it("leaves the checkout untouched whatever the worktree does", async () => {
    await link();
    fs.rmSync(path.join(worktree, "node_modules"), { recursive: true });
    expect(
      fs.readFileSync(
        path.join(source, "node_modules", "dep", "index.js"),
        "utf-8"
      )
    ).toBe("1");
  });

  it("makes no store when the lockfile differs", async () => {
    fs.writeFileSync(path.join(worktree, "package-lock.json"), '{"v":2}');
    const r = await link();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/lockfile differs/);
    expect(fs.existsSync(path.join(tmp, "store"))).toBe(false);
  });

  it("falls back (not ok) when the store can't be made", async () => {
    fs.writeFileSync(path.join(tmp, "blocked"), "a file, not a folder");
    const r = await cloneDeps({
      sourcePath: source,
      worktreePath: worktree,
      spareRoot: spares,
      storeRoot: path.join(tmp, "blocked", "store"),
      mode: "hardlink",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/store/);
    expect(fs.existsSync(path.join(worktree, "node_modules"))).toBe(false);
  });

  it("skips a declared non-node_modules folder rather than linking it", async () => {
    fs.mkdirSync(path.join(source, ".venv"));
    fs.writeFileSync(path.join(source, ".venv", "py"), "1");
    const { refill, ...r } = await cloneDeps({
      sourcePath: source,
      worktreePath: worktree,
      spareRoot: spares,
      storeRoot: path.join(tmp, "store"),
      mode: "hardlink",
      only: ["node_modules", ".venv"],
    });
    await refill;
    expect(r.ok).toBe(true);
    expect(r.skipped).toEqual([".venv (not linked)"]);
    expect(fs.existsSync(path.join(worktree, ".venv"))).toBe(false);
  });
});

describe("nodeModulesMatchLock", () => {
  const lockWith = (packages: object) =>
    fs.writeFileSync(
      path.join(source, "package-lock.json"),
      JSON.stringify({ packages: { "": {}, ...packages } })
    );
  const installed = (packages: object) =>
    fs.writeFileSync(
      path.join(source, "node_modules", ".package-lock.json"),
      JSON.stringify({ packages })
    );

  it("passes when every listed package is installed at its version", async () => {
    lockWith({
      "node_modules/a": { version: "1.0.0" },
      "node_modules/b": { version: "2.0.0", optional: true },
    });
    installed({ "node_modules/a": { version: "1.0.0" } });
    expect(await nodeModulesMatchLock(source)).toBe(true);
  });

  it("fails on a missing or different package, and a missing hidden lockfile", async () => {
    lockWith({ "node_modules/a": { version: "1.0.0" } });
    expect(await nodeModulesMatchLock(source)).toBe(false);
    installed({ "node_modules/a": { version: "0.9.0" } });
    expect(await nodeModulesMatchLock(source)).toBe(false);
  });

  it("makes the clone fall back to an install", async () => {
    lockWith({ "node_modules/a": { version: "1.0.0" } });
    fs.copyFileSync(
      path.join(source, "package-lock.json"),
      path.join(worktree, "package-lock.json")
    );
    const r = await cloneDeps({
      sourcePath: source,
      worktreePath: worktree,
      spareRoot: spares,
      mode: "clone",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not what its lockfile lists/);
    expect(fs.existsSync(path.join(worktree, "node_modules"))).toBe(false);
  });
});
