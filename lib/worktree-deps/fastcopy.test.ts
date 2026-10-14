import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fastCopyMode, unlinkMutable } from "./fastcopy";
import { copyArgs } from "./spare";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aos-fast-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("copyArgs", () => {
  it("is the cp for each mode", () => {
    expect(copyArgs("clone", "a", "b")).toEqual(["-Rc", "a", "b"]);
    expect(copyArgs("reflink", "a", "b")).toEqual([
      "-a",
      "--reflink=always",
      "a",
      "b",
    ]);
    expect(copyArgs("hardlink", "a", "b")).toEqual(["-al", "a", "b"]);
    expect(copyArgs("copy", "a", "b")).toEqual(["-a", "a", "b"]);
  });
});

describe("fastCopyMode", () => {
  const opts = () => ({
    sourcePath: tmp,
    worktreePath: tmp,
    storeRoot: path.join(tmp, "store"),
  });

  it("clones on macOS and does nothing elsewhere", async () => {
    expect(await fastCopyMode({ ...opts(), platform: "darwin" })).toBe("clone");
    expect(await fastCopyMode({ ...opts(), platform: "win32" })).toBeNull();
  });

  it("on Linux is a reflink or a hardlink store on the same filesystem", async () => {
    expect(["reflink", "hardlink"]).toContain(
      await fastCopyMode({ ...opts(), platform: "linux" })
    );
  });

  it("has none for a worktree that doesn't exist", async () => {
    expect(
      await fastCopyMode({
        ...opts(),
        worktreePath: path.join(tmp, "nope"),
        platform: "linux",
      })
    ).toBeNull();
  });
});

describe("unlinkMutable", () => {
  it("replaces the files tools rewrite with real copies, leaving the rest linked", async () => {
    const store = path.join(tmp, "store");
    const wt = path.join(tmp, "wt");
    fs.mkdirSync(path.join(store, ".cache"), { recursive: true });
    fs.writeFileSync(path.join(store, ".package-lock.json"), "{}");
    fs.writeFileSync(path.join(store, ".cache", "c"), "c");
    fs.writeFileSync(path.join(store, "dep.js"), "d");
    fs.cpSync(store, wt, { recursive: true });
    for (const f of [".package-lock.json", "dep.js"]) {
      fs.rmSync(path.join(wt, f));
      fs.linkSync(path.join(store, f), path.join(wt, f));
    }
    await unlinkMutable(wt);
    const ino = (d: string, f: string) => fs.statSync(path.join(d, f)).ino;
    expect(ino(wt, ".package-lock.json")).not.toBe(
      ino(store, ".package-lock.json")
    );
    expect(ino(wt, ".cache/c")).not.toBe(ino(store, ".cache/c"));
    expect(ino(wt, "dep.js")).toBe(ino(store, "dep.js"));
    fs.appendFileSync(path.join(wt, ".package-lock.json"), "x");
    expect(
      fs.readFileSync(path.join(store, ".package-lock.json"), "utf-8")
    ).toBe("{}");
  });
});
