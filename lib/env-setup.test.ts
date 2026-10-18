import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { setupWorktree } from "./env-setup";
import { unsavedChanges } from "./worktree-placed";
import { tempDir } from "@/lib/test-temp";

const tmp = (p: string) => tempDir(p);

function checkout(config: unknown, files: Record<string, string> = {}) {
  const source = tmp("aos-src-");
  const worktree = tmp("aos-wt-");
  if (config !== undefined)
    fs.writeFileSync(path.join(source, "agentos.json"), JSON.stringify(config));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(source, name)), { recursive: true });
    fs.writeFileSync(path.join(source, name), body);
  }
  return { source, worktree };
}

const read = (dir: string, name: string) =>
  fs.readFileSync(path.join(dir, name), "utf-8");

describe("setupWorktree with agentos.json", () => {
  it("copies exactly what copy names, folders included", async () => {
    const { source, worktree } = checkout(
      { copy: [".env.local", "config/master.key", "missing.txt"] },
      { ".env": "no", ".env.local": "yes", "config/master.key": "k" }
    );
    const result = await setupWorktree({
      worktreePath: worktree,
      sourcePath: source,
    });
    expect(result.success).toBe(true);
    expect(result.envFilesCopied).toEqual([".env.local", "config/master.key"]);
    expect(read(worktree, ".env.local")).toBe("yes");
    expect(read(worktree, "config/master.key")).toBe("k");
    expect(fs.existsSync(path.join(worktree, ".env"))).toBe(false);
  });

  describe("private CLAUDE.md", () => {
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", args, { cwd, stdio: "pipe" });
    function repo(gitignore: string, tracked = false) {
      const { source, worktree } = checkout(undefined, {
        "CLAUDE.md": "private notes",
      });
      git(worktree, "init", "-q");
      git(worktree, "config", "user.email", "t@example.com");
      git(worktree, "config", "user.name", "t");
      fs.writeFileSync(path.join(worktree, ".gitignore"), gitignore);
      if (tracked) {
        fs.writeFileSync(path.join(worktree, "CLAUDE.md"), "committed");
        git(worktree, "add", "-f", "CLAUDE.md");
      }
      return { source, worktree };
    }
    const run = (source: string, worktree: string) =>
      setupWorktree({
        worktreePath: worktree,
        sourcePath: source,
        skipInstall: true,
      });

    it("is copied when the worktree ignores it", async () => {
      const { source, worktree } = repo("CLAUDE.md\n");
      expect((await run(source, worktree)).envFilesCopied).toEqual([
        "CLAUDE.md",
      ]);
      expect(read(worktree, "CLAUDE.md")).toBe("private notes");
    });

    it("is not copied over a tracked one", async () => {
      const { source, worktree } = repo("CLAUDE.md\n", true);
      expect((await run(source, worktree)).envFilesCopied).toEqual([]);
      expect(read(worktree, "CLAUDE.md")).toBe("committed");
    });

    it("is not copied when it would be untracked but not ignored", async () => {
      const { source, worktree } = repo("");
      expect((await run(source, worktree)).envFilesCopied).toEqual([]);
      expect(fs.existsSync(path.join(worktree, "CLAUDE.md"))).toBe(false);
    });
  });

  it("never writes through a symlink at an env file's place", async () => {
    const { source, worktree } = checkout(undefined, { ".env": "secret" });
    const outside = path.join(tmp("aos-out-"), "target");
    fs.symlinkSync(outside, path.join(worktree, ".env"));
    await setupWorktree({
      worktreePath: worktree,
      sourcePath: source,
      skipInstall: true,
    });
    expect(fs.existsSync(outside)).toBe(false);
    expect(fs.lstatSync(path.join(worktree, ".env")).isSymbolicLink()).toBe(
      false
    );
    expect(read(worktree, ".env")).toBe("secret");
  });

  it("leaves a dangling symlink at CLAUDE.md alone", async () => {
    const { source, worktree } = checkout(undefined, { "CLAUDE.md": "n" });
    const outside = path.join(tmp("aos-out-"), "target");
    fs.symlinkSync(outside, path.join(worktree, "CLAUDE.md"));
    await setupWorktree({
      worktreePath: worktree,
      sourcePath: source,
      skipInstall: true,
    });
    expect(fs.existsSync(outside)).toBe(false);
  });

  it("seeds build caches even when setup commands replace the install", async () => {
    const { source, worktree } = checkout(
      { setup: ["true"], caches: ["*.tsbuildinfo", ".next/cache"] },
      { "a.tsbuildinfo": "T", ".next/cache/x": "X", "other.tsbuildinfo": "O" }
    );
    const result = await setupWorktree({
      worktreePath: worktree,
      sourcePath: source,
    });
    expect(result.success).toBe(true);
    expect(
      result.steps.find((s) => s.name === "Seed build caches")
    ).toMatchObject({ success: true });
    expect(read(worktree, "a.tsbuildinfo")).toBe("T");
    expect(read(worktree, ".next/cache/x")).toBe("X");
  });

  it("seeds nothing when caches is empty", async () => {
    const { source, worktree } = checkout(
      { setup: ["true"], caches: [] },
      { "a.tsbuildinfo": "T" }
    );
    await setupWorktree({ worktreePath: worktree, sourcePath: source });
    expect(fs.existsSync(path.join(worktree, "a.tsbuildinfo"))).toBe(false);
  });

  it("refuses a copy whose symlink leads outside the project", async () => {
    const outside = tmp("aos-outside-");
    fs.writeFileSync(path.join(outside, "secret"), "s");
    const { source, worktree } = checkout({ copy: ["link/secret"] });
    fs.symlinkSync(outside, path.join(source, "link"));
    const result = await setupWorktree({
      worktreePath: worktree,
      sourcePath: source,
    });
    expect(result.success).toBe(false);
    expect(result.steps.find((s) => s.name === "Copy files")?.error).toContain(
      "link/secret"
    );
    expect(fs.existsSync(path.join(worktree, "link"))).toBe(false);
  });

  it("never writes through a symlink the branch put in the worktree", async () => {
    const outside = tmp("aos-outside-");
    const { source, worktree } = checkout(
      { copy: ["config/master.key", "config/deep/k", "link.key"] },
      { "config/master.key": "k", "config/deep/k": "d", "link.key": "l" }
    );
    fs.symlinkSync(outside, path.join(worktree, "config"));
    fs.symlinkSync(
      path.join(outside, "victim"),
      path.join(worktree, "link.key")
    );
    const result = await setupWorktree({
      worktreePath: worktree,
      sourcePath: source,
    });
    expect(result.envFilesCopied).toEqual(["link.key"]);
    expect(result.steps.find((s) => s.name === "Copy files")?.error).toContain(
      "config/master.key, config/deep/k"
    );
    expect(fs.readdirSync(outside)).toEqual([]);
    expect(fs.lstatSync(path.join(worktree, "link.key")).isSymbolicLink()).toBe(
      false
    );
  });

  it("runs setup with the ports and env exported, ports over env", async () => {
    const { source, worktree } = checkout({
      env: { MODE: "env-sentinel-7f3a", WEB: "wrong" },
      setup: [
        'printf "%s %s %s" "$WEB" "$MODE" "$WORKTREE_PATH" > out.txt',
        "echo $WEB > port.txt",
      ],
    });
    const result = await setupWorktree({
      worktreePath: worktree,
      sourcePath: source,
      ports: { WEB: 3004 },
    });
    expect(result.success).toBe(true);
    expect(read(worktree, "out.txt")).toBe(
      `3004 env-sentinel-7f3a ${worktree}`
    );
    // Ports are written into the logged command; env values never are.
    expect(result.steps.map((s) => s.command)).toContain(
      "echo 3004 > port.txt"
    );
    for (const step of result.steps)
      expect(`${step.command} ${step.output ?? ""}`).not.toContain(
        "env-sentinel-7f3a"
      );
  });

  it("reports a broken agentos.json and runs nothing of it", async () => {
    const { source, worktree } = checkout({ setup: "not a list" });
    fs.writeFileSync(
      path.join(source, ".agent-os.json"),
      JSON.stringify({ setup: ["touch legacy"] })
    );
    const result = await setupWorktree({
      worktreePath: worktree,
      sourcePath: source,
    });
    expect(result.success).toBe(false);
    expect(result.steps[0]).toMatchObject({
      name: "Read agentos.json",
      success: false,
    });
    expect(result.steps[0].error).toContain("setup");
    expect(fs.existsSync(path.join(worktree, "legacy"))).toBe(false);
  });

  it.skipIf(process.platform !== "darwin")(
    "clones a declared folder that isn't node_modules",
    async () => {
      const { source, worktree } = checkout(
        { clone: [".venv"] },
        { ".venv/bin/python": "py" }
      );
      const result = await setupWorktree({
        worktreePath: worktree,
        sourcePath: source,
      });
      expect(result.success).toBe(true);
      expect(read(worktree, ".venv/bin/python")).toBe("py");
    }
  );

  it.skipIf(process.platform !== "darwin")(
    "leaves a new worktree with nothing uncommitted: env copied, dependencies cloned",
    async () => {
      const root = tmp("aos-setup-git-");
      const repo = path.join(root, "repo");
      const worktree = path.join(root, "wt");
      const git = (cwd: string, ...args: string[]) =>
        execFileSync("git", args, { cwd, stdio: "pipe" });
      fs.mkdirSync(repo);
      git(repo, "init", "-q", "-b", "main");
      fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules\n.env\n");
      fs.writeFileSync(path.join(repo, "package.json"), "{}");
      fs.writeFileSync(path.join(repo, "package-lock.json"), '{"v":1}');
      fs.writeFileSync(path.join(repo, "LICENSE"), "MIT\n");
      git(repo, "add", "-A");
      git(
        repo,
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@e",
        "commit",
        "-qm",
        "init"
      );
      fs.writeFileSync(path.join(repo, ".env"), "KEY=1\n");
      fs.writeFileSync(path.join(repo, ".env.local"), "KEY=2\n");
      fs.mkdirSync(path.join(repo, "node_modules", "dep"), { recursive: true });
      fs.writeFileSync(path.join(repo, "node_modules", "dep", "index.js"), "1");
      git(repo, "worktree", "add", "-q", "-b", "feature/x", worktree, "main");

      const result = await setupWorktree({
        worktreePath: worktree,
        sourcePath: repo,
      });
      expect(result.success).toBe(true);
      expect(read(worktree, "node_modules/dep/index.js")).toBe("1");
      expect(read(worktree, ".env.local")).toBe("KEY=2\n");
      expect(await unsavedChanges(worktree)).toEqual([]);
    }
  );
});
