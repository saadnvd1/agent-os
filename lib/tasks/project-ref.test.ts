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

import { NextRequest } from "next/server";
import { getProject } from "../projects";
import { POST as availability } from "../../app/api/projects/availability/route";
import { POST as startSession } from "../../app/api/sessions/route";
import {
  ensureProject,
  homeRelative,
  repoIdentity,
  safeRelative,
  whyNotHere,
  withoutCredentials,
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
    const before = clones.length;
    git(f.repo, "remote", "set-url", "origin", "git@github.com:me/app.git");
    expect(
      await whyNotHere({
        name: "app",
        path: "x/app",
        remote: "https://github.com/me/app",
      })
    ).toBeNull();
    git(f.repo, "remote", "set-url", "origin", f.origin);
    // A repository in the folder that no project names yet is taken as is.
    git(f.tmp, "init", "-q", path.join(f.tmp, "dev", "why-repo"));
    expect(
      await whyNotHere({ name: "r", path: "dev/why-repo", remote: null })
    ).toBeNull();
    expect(
      await whyNotHere({ name: "z", path: "dev/why-none", remote: null })
    ).toMatch(/no remote to clone/);
    fs.mkdirSync(path.join(f.tmp, "dev", "why-plain"), { recursive: true });
    fs.writeFileSync(path.join(f.tmp, "dev", "why-plain", "a"), "");
    expect(
      await whyNotHere({
        name: "n",
        path: "dev/why-plain",
        remote: "https://h/x",
      })
    ).toMatch(/isn't a git repository/);
    expect(
      await whyNotHere({
        name: "u",
        path: "dev/why-u",
        remote: "https://127.0.0.1:1/u.git",
      })
    ).toBe("Can't clone it there");
    expect(await whyNotHere({ name: "o", path: "../o", remote: null })).toMatch(
      /Bad project folder/
    );
    expect(clones).toHaveLength(before);
    expect(fs.existsSync(path.join(f.tmp, "dev", "why-u"))).toBe(false);
  });

  it("never lets a remote's credentials leave the machine", () => {
    expect(
      withoutCredentials("https://x-access-token:ghp_abc@github.com/me/app.git")
    ).toBe("https://github.com/me/app.git");
    expect(withoutCredentials("https://ghp_abc@github.com/me/app")).toBe(
      "https://github.com/me/app"
    );
    expect(withoutCredentials("ssh://git:secret@host/me/app")).toBe(
      "ssh://git@host/me/app"
    );
    expect(withoutCredentials("ssh://git@host/me/app")).toBe(
      "ssh://git@host/me/app"
    );
    expect(withoutCredentials("git@github.com:me/app.git")).toBe(
      "git@github.com:me/app.git"
    );
    expect(withoutCredentials(null)).toBeNull();
  });
});

describe("a ref another machine sends", () => {
  const post = (body: unknown) =>
    new NextRequest("http://x/api", {
      method: "POST",
      body: JSON.stringify(body),
    });

  it("is refused before anything reads it when it isn't one", async () => {
    const bad = [
      {},
      { project: { name: 1, path: "dev/x", remote: null } },
      { project: { name: "x", path: ["dev"], remote: null } },
      { project: { name: "x", path: "dev/x", remote: 5 } },
    ];
    for (const body of bad) {
      const res = await availability(post(body));
      expect(res.status).toBe(400);
    }
    const before = clones.length;
    for (const body of bad.slice(1)) {
      const res = await startSession(post({ ...body, agentType: "claude" }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Bad project");
    }
    expect(clones).toHaveLength(before);
    const ok = await availability(
      post({ project: { name: "z", path: "dev/ref-none", remote: null } })
    );
    expect(await ok.json()).toEqual({
      reason: "Not there, and no remote to clone",
    });
  });
});
