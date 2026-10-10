import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  describeChanges,
  parsePorcelain,
  readPlaced,
  recordPlaced,
  unsavedChanges,
} from "./worktree-placed";
import { setupWorktree } from "./env-setup";

let root: string;
let repo: string;
let wt: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" });
const write = (rel: string, body: string) => {
  fs.mkdirSync(path.dirname(path.join(wt, rel)), { recursive: true });
  fs.writeFileSync(path.join(wt, rel), body);
};

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "placed-")));
  repo = path.join(root, "repo");
  wt = path.join(root, "wt");
  fs.mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "t");
  git(repo, "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(repo, "tracked.json"), "{}\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "first");
  git(repo, "worktree", "add", "-q", "-b", "f", wt);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// Setup copies from the main checkout; these copy the same way.
const copy = (rel: string, body: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), body);
  write(rel, body);
};

describe("unsavedChanges", () => {
  it("leaves out what setup copied and nobody touched", async () => {
    copy(".env", "A=1\n");
    copy("config/local.json", "{}\n");
    copy("config/deep/x.json", "{}\n");
    write("tracked.json", '{"from":"main"}\n');
    fs.writeFileSync(path.join(repo, "tracked.json"), '{"from":"main"}\n');
    await recordPlaced(wt, repo, [".env", "config", "tracked.json"]);
    expect(await unsavedChanges(wt)).toEqual([]);
    // Kept outside the working tree.
    expect(git(wt, "status", "--porcelain", "--ignored")).not.toContain(
      "agentos-placed"
    );
  });

  it("still counts a real edit, a new file, or an edited copy", async () => {
    copy(".env", "A=1\n");
    copy("config/local.json", "{}\n");
    await recordPlaced(wt, repo, [".env", "config"]);
    write(".env", "A=2\n");
    write("config/mine.ts", "work\n");
    write("tracked.json", "edited\n");
    write("notes.md", "keep\n");
    expect((await unsavedChanges(wt)).sort()).toEqual(
      [".env", "config/", "notes.md", "tracked.json"].sort()
    );
  });

  it("never records what an agent wrote before the record was made", async () => {
    copy(".env", "A=1\n");
    copy("config/local.json", "{}\n");
    // The agent got there first: an edit, and a file of its own.
    write(".env", "A=mine\n");
    write("config/mine.ts", "work\n");
    await recordPlaced(wt, repo, [".env", "config"]);
    expect(Object.keys((await readPlaced(wt)).files)).toEqual([
      "config/local.json",
    ]);
    expect((await unsavedChanges(wt)).sort()).toEqual([".env", "config/"]);
  });

  it("never changes an entry once recorded", async () => {
    copy(".env", "A=1\n");
    await recordPlaced(wt, repo, [".env"]);
    write(".env", "A=2\n");
    fs.writeFileSync(path.join(repo, ".env"), "A=2\n");
    await recordPlaced(wt, repo, [".env"]);
    expect(await unsavedChanges(wt)).toEqual([".env"]);
  });

  it("never records a path outside the worktree", async () => {
    await recordPlaced(wt, repo, ["../repo/tracked.json", "/etc/hosts", "."]);
    expect(await readPlaced(wt)).toEqual({ files: {} });
  });

  it("counts staged changes, even to a copied file", async () => {
    copy(".env", "A=1\n");
    await recordPlaced(wt, repo, [".env"]);
    git(wt, "add", "-f", ".env");
    expect(await unsavedChanges(wt)).toEqual([".env"]);
  });
});

describe("setupWorktree", () => {
  it("records the env files it copied", async () => {
    fs.writeFileSync(path.join(repo, ".env.local"), "S=1\n");
    await setupWorktree({
      worktreePath: wt,
      sourcePath: repo,
      skipInstall: true,
    });
    expect(fs.readFileSync(path.join(wt, ".env.local"), "utf-8")).toBe("S=1\n");
    expect(Object.keys((await readPlaced(wt)).files)).toEqual([".env.local"]);
    expect(await unsavedChanges(wt)).toEqual([]);
  });
});

describe("parsePorcelain and describeChanges", () => {
  it("takes a rename by its new path", () => {
    expect(parsePorcelain("R  new.ts\0old.ts\0?? a b.txt\0 M c\0")).toEqual([
      ["R ", "new.ts"],
      ["??", "a b.txt"],
      [" M", "c"],
    ]);
  });

  it("names a few files and counts the rest", () => {
    expect(describeChanges(["a"])).toBe("1 file: a");
    expect(describeChanges(["a", "b", "c"])).toBe("3 files: a, b, c");
    expect(describeChanges(["a", "b", "c", "d"], 2)).toBe(
      "4 files: a, b, and 2 more"
    );
  });
});
