import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { setupWorktree } from "./env-setup";
import { unsavedChanges } from "./worktree-placed";

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));

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
