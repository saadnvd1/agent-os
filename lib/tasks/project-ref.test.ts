import fs from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const clones = vi.hoisted(() => [] as string[][]);
vi.mock("./gh", async (orig) => {
  const real = await orig<typeof import("./gh")>();
  return {
    ...real,
    // A clone is recorded and faked (no network); everything else is real git.
    run: vi.fn(async (cmd: string, args: string[], cwd: string, t?: number) => {
      if (cmd === "git" && args[0] === "clone") {
        clones.push(args);
        const dir = args.at(-1)!;
        (await import("fs")).mkdirSync(`${dir}/.git`, { recursive: true });
        return "";
      }
      return real.run(cmd, args, cwd, t);
    }),
  };
});

import { getProject } from "../projects";
import {
  ensureProject,
  homeRelative,
  repoIdentity,
  safeRelative,
  whyNotHere,
} from "./project-ref";
import { git, setupMoveRepo, type MoveFixture } from "./move-testing";

describe("the same project on another machine", () => {
  it("knows a repository however its remote is written", () => {
    const id = "github.com/acme/app";
    expect(repoIdentity("https://github.com/acme/app.git")).toBe(id);
    expect(repoIdentity("git@github.com:acme/app.git")).toBe(id);
    expect(repoIdentity("ssh://git@github.com/Acme/app/")).toBe(id);
    expect(repoIdentity("https://x-token@github.com/acme/app")).toBe(id);
    expect(repoIdentity(null)).toBeNull();
    expect(repoIdentity("/tmp/local.git")).toBeNull();
  });

  it("names its folder relative to home, and only inside it", () => {
    expect(homeRelative("/Users/s/dev/app", "/Users/s")).toBe("dev/app");
    expect(() => homeRelative("/etc", "/Users/s")).toThrow(/home folder/);
    expect(() => homeRelative("/Users/sx/app", "/Users/s")).toThrow();
  });

  it("refuses a folder that climbs out of home", () => {
    expect(safeRelative("dev/app")).toBe("dev/app");
    for (const bad of ["../etc", "dev/../../etc", "/etc", "", "."])
      expect(() => safeRelative(bad)).toThrow();
  });
});

describe("ensureProject", () => {
  let f: MoveFixture;
  beforeAll(() => {
    f = setupMoveRepo();
  });
  afterAll(() => f.restore());

  it("finds the project by its repository, wherever its folder is", async () => {
    git(f.repo, "remote", "set-url", "origin", "git@github.com:me/app.git");
    const p = await ensureProject({
      name: "app",
      path: "elsewhere/app",
      remote: "https://github.com/me/app",
    });
    expect(p.id).toBe(f.projectId);
    git(f.repo, "remote", "set-url", "origin", f.origin);
  });

  it("adopts a repository already in the folder without cloning", async () => {
    const dir = path.join(f.tmp, "dev", "kept");
    git(f.tmp, "init", "-q", dir);
    const p = await ensureProject({
      name: "kept",
      path: "dev/kept",
      remote: null,
    });
    expect(getProject(p.id)?.working_directory).toBe("~/dev/kept");
    expect(clones).toEqual([]);
  });

  it("clones a missing project from its remote, with -- before the URL", async () => {
    const p = await ensureProject({
      name: "new",
      path: "dev/new",
      remote: "https://github.com/me/new.git",
    });
    expect(clones.at(-1)).toEqual([
      "clone",
      "--",
      "https://github.com/me/new.git",
      path.join(f.tmp, "dev", "new"),
    ]);
    expect(getProject(p.id)?.working_directory).toBe("~/dev/new");
  });

  it("refuses remotes that aren't plain git URLs, and folders it would take over", async () => {
    for (const remote of [
      "ext::sh -c x",
      "--upload-pack=x",
      "file:///etc",
      null,
    ])
      await expect(
        ensureProject({ name: "x", path: "dev/x", remote })
      ).rejects.toThrow(/no remote to clone/);
    fs.mkdirSync(path.join(f.tmp, "dev", "notgit"), { recursive: true });
    fs.writeFileSync(path.join(f.tmp, "dev", "notgit", "a"), "");
    await expect(
      ensureProject({ name: "n", path: "dev/notgit", remote: "https://h/x" })
    ).rejects.toThrow(/isn't a git repository/);
    await expect(
      ensureProject({ name: "n", path: "../out", remote: "https://h/x" })
    ).rejects.toThrow(/Bad project folder/);
    expect(clones).toHaveLength(1);
  });

  it("says why it couldn't take a project, without cloning", async () => {
    git(f.repo, "remote", "set-url", "origin", "git@github.com:me/app.git");
    expect(
      await whyNotHere({
        name: "app",
        path: "x/app",
        remote: "https://github.com/me/app",
      })
    ).toBeNull();
    git(f.repo, "remote", "set-url", "origin", f.origin);
    expect(
      await whyNotHere({ name: "k", path: "dev/kept", remote: null })
    ).toBeNull();
    expect(
      await whyNotHere({ name: "z", path: "dev/z", remote: null })
    ).toMatch(/no remote to clone/);
    expect(
      await whyNotHere({ name: "n", path: "dev/notgit", remote: "https://h/x" })
    ).toMatch(/isn't a git repository/);
    expect(
      await whyNotHere({
        name: "u",
        path: "dev/u",
        remote: "https://127.0.0.1:1/u.git",
      })
    ).toBe("Can't clone it there");
    expect(await whyNotHere({ name: "o", path: "../o", remote: null })).toMatch(
      /Bad project folder/
    );
    expect(clones).toHaveLength(1);
    expect(fs.existsSync(path.join(f.tmp, "dev", "u"))).toBe(false);
  });
});
