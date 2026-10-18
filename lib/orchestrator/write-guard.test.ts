import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createWorkspace as createWs, updateWorkspace } from "@/lib/workspaces";
import { addProjectRepository, createProject } from "@/lib/projects";
import {
  Approvals,
  guardHook,
  preToolUseHooks,
} from "@/lib/chat/drivers/claude-approvals";
import { ensureOrchestrator, orchestratorDir } from "./home";
import { LIMITS_FILE } from "./usage";
import {
  orchestratorToolRefusal,
  physicalPath,
  writeRefusal,
  type WriteBounds,
} from "./write-guard";

// These tests are the guards as they are with Orchestrator full access off.
const createWorkspace = (name: string) => {
  const w = createWs(name);
  return updateWorkspace(w.id, { orchFullAccess: false })!;
};

// A home with a project repo, a task worktree, AgentOS's state with the
// orchestrator's own folder, and somewhere ordinary to write.
let home: string;
let bounds: WriteBounds;
const at = (...p: string[]) => path.join(home, ...p);
// As given, with no `..` taken by name.
const raw = (p: string) => `${home}/${p}`;

beforeAll(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aos-wg-")));
  vi.spyOn(os, "homedir").mockReturnValue(home);
  for (const d of [
    "dev/app/src",
    ".agent-os/worktrees/app-fix/src",
    ".agent-os/orchestrators/w1",
    "notes/repo/.git/hooks",
    ".ssh",
    "Library/LaunchAgents",
    "bin",
  ])
    fs.mkdirSync(at(d), { recursive: true });
  // Ways back into the repo from places that look writable.
  fs.symlinkSync(at("dev/app"), at("notes/app-link"));
  fs.symlinkSync(at("dev/app/src/new.ts"), at("notes/dangling"));
  fs.symlinkSync(at("dev/app/src"), at("notes/deep"));
  fs.symlinkSync(at(".ssh"), at("notes/keys"));
  // A way out of the repo, so `..` by name lands back in it.
  fs.symlinkSync(at("notes"), at("dev/app/out"));
  // Links kept in protected places, pointing somewhere ordinary.
  fs.mkdirSync(at("dotfiles"));
  fs.writeFileSync(at("dotfiles/zshrc"), "");
  fs.symlinkSync(at("dotfiles/zshrc"), at(".zshrc"));
  fs.writeFileSync(at("dotfiles/git"), "");
  fs.symlinkSync(at("dotfiles/git"), at("bin/git"));
  bounds = {
    cwd: at(".agent-os/orchestrators/w1"),
    ownDir: at(".agent-os/orchestrators/w1"),
    state: at(".agent-os"),
    repos: [at("dev/app"), at(".agent-os/worktrees")],
    home,
    runs: [at("Library"), at("bin")],
  };
});

const refused = (p: string) => writeRefusal(p, bounds);

describe("writeRefusal", () => {
  it("allows writes outside projects, and in its own folder", async () => {
    expect(await refused(at("notes/plan.md"))).toBeNull();
    expect(await refused(at("notes/new/dir/plan.md"))).toBeNull();
    expect(await refused(at(".agent-os/orchestrators/w1/todo.md"))).toBeNull();
    expect(await refused("todo.md")).toBeNull();
    expect(await refused("~/notes/plan.md")).toBeNull();
  });

  it("refuses a project repository and its task worktrees", async () => {
    expect(await refused(at("dev/app/src/index.ts"))).toMatch(
      /project repository.*start_task/
    );
    expect(await refused(at("dev/app"))).toMatch(/project repository/);
    expect(await refused(at("dev/app/new/file.ts"))).toMatch(
      /project repository/
    );
    expect(
      await refused(at(".agent-os/worktrees/app-fix/src/index.ts"))
    ).toMatch(/project repository/);
    expect(await refused("~/dev/app/README.md")).toMatch(/project repository/);
  });

  it("refuses AgentOS's state outside its own folder", async () => {
    expect(await refused(at(".agent-os/agentos.db"))).toMatch(/own state/);
    expect(await refused(at(".agent-os/orchestrators/w2/notes.md"))).toMatch(
      /own state/
    );
  });

  it("refuses symlink and .. tricks into a repository", async () => {
    // A link to the repo, and a dangling one whose write would create a file there.
    expect(await refused(at("notes/app-link/src/x.ts"))).toMatch(
      /project repository/
    );
    expect(await refused(at("notes/dangling"))).toMatch(/project repository/);
    // `..` by name lands in notes, but the system takes it from the link's
    // real folder: dev/app.
    expect(await refused(raw("notes/deep/../package.json"))).toMatch(
      /project repository/
    );
    expect(await refused(raw("notes/../dev/app/x.ts"))).toMatch(
      /project repository/
    );
    expect(await refused(".././../../dev/app/src/x.ts")).toMatch(
      /project repository/
    );
    expect(await refused(raw("dev/./app/x.ts"))).toMatch(/project repository/);
    // Out through a link, but a tool taking `..` by name writes into the repo.
    expect(await refused(raw("dev/app/out/../x.ts"))).toMatch(
      /project repository/
    );
  });

  it("refuses its own folder's way out through ..", async () => {
    expect(await refused(raw(".agent-os/orchestrators/w1/../w2/x"))).toMatch(
      /own state/
    );
  });

  it.runIf(process.platform === "darwin")(
    "refuses a repository spelt in another case",
    async () => {
      expect(await refused(at("DEV/App/src/x.ts"))).toMatch(
        /project repository/
      );
    }
  );

  it("refuses secret paths", async () => {
    for (const p of [
      at(".ssh/config"),
      at(".ssh/authorized_keys"),
      at(".aws/credentials"),
      at(".config/tokenvault/tokens.enc"),
      at("notes/.env"),
      at("notes/.env.local"),
      at("notes/server.pem"),
      at("notes/keys/id_ed25519"),
      // Only the link's target makes these secret.
      at("notes/keys/authorized_keys"),
      at("notes/keys/config"),
      at(".config/gh/hosts.yml"),
      at(".docker/config.json"),
    ])
      expect(await refused(p), p).toMatch(/secrets/);
    expect(await refused(at("notes/environment.md"))).toBeNull();
  });

  it("refuses files that make something run", async () => {
    for (const p of [
      at(".zshenv"),
      at(".zprofile"),
      at(".bashrc"),
      at(".bash_profile"),
      at(".claude/settings.local.json"),
      at(".claude/hooks/pre.sh"),
      at(".serviceman/services/backup.json"),
      at(".zshrc"),
      at(".profile"),
      at(".gitconfig"),
      at(".config/git/config"),
      at(".claude/settings.json"),
      at(".claude/.context-cost/limits.json"),
      at(".local/bin/aos"),
      at(".agent-os/orchestrators/w1/.claude/settings.local.json"),
      at(".agent-os/orchestrators/w1/.mcp.json"),
      at(".agent-os/orchestrators/w1/CLAUDE.md"),
      at("notes/repo/.git/hooks/pre-commit"),
      at("notes/repo/.git/config"),
      at("notes/.envrc"),
      at("notes/site.pth"),
      at("Library/LaunchAgents/x.plist"),
      at("bin/aos"),
      // The link is the protected file, wherever it points.
      at("bin/git"),
    ])
      expect(await refused(p), p).toMatch(/configures what runs/);
    expect(await refused(at(".zshrc"))).toMatch(/configures what runs/);
    expect(await refused(at("dotfiles/zshrc"))).toBeNull();
    // A dotfile below the top of home is ordinary.
    expect(await refused(at("notes/.gitignore"))).toBeNull();
    expect(await refused(at("notes/repo/README.md"))).toBeNull();
  });

  it("refuses AgentOS's review and rebase checkouts", async () => {
    for (const d of [
      "aos-review-x1/src/a.ts",
      "aos-rebase-y2/a.ts",
      "aos-body-z3/body.md",
    ])
      expect(await refused(path.join(os.tmpdir(), d)), d).toMatch(
        /reviewing or rebasing/
      );
    expect(await refused(path.join(os.tmpdir(), "aos-notes.md"))).toBeNull();
  });

  it("refuses a path with no file", async () => {
    expect(await refused("")).toMatch(/No file path/);
  });
});

describe("physicalPath", () => {
  it("follows links where they sit and takes .. from the real folder", async () => {
    expect(await physicalPath(raw("notes/deep/../x"))).toBe(at("dev/app/x"));
    expect(await physicalPath(at("notes/dangling"))).toBe(
      at("dev/app/src/new.ts")
    );
  });

  it("stops on a symlink loop", async () => {
    fs.symlinkSync(at("notes/loop-b"), at("notes/loop-a"));
    fs.symlinkSync(at("notes/loop-a"), at("notes/loop-b"));
    expect(await refused(at("notes/loop-a/x"))).toMatch(/Too many symlinks/);
  });
});

describe("an orchestrator's writes", () => {
  it("are checked against every project in the database", async () => {
    const w = createWorkspace("Guarded");
    const o = ensureOrchestrator(w.id);
    const repo = at("dev/guarded");
    const second = at("dev/guarded-api");
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(second, { recursive: true });
    const p = createProject({
      name: "guarded",
      workingDirectory: "~/dev/guarded",
      workspaceId: w.id,
    } as Parameters<typeof createProject>[0]);
    addProjectRepository(p.id, { name: "api", path: second });

    const write = (file: string, tool = "Write") =>
      orchestratorToolRefusal(o, tool, {
        [tool === "NotebookEdit" ? "notebook_path" : "file_path"]: file,
      });
    expect(await write(path.join(repo, "a.ts"))).toMatch(/project repository/);
    expect(await write(path.join(second, "a.ts"), "Edit")).toMatch(
      /project repository/
    );
    expect(await write(path.join(repo, "nb.ipynb"), "NotebookEdit")).toMatch(
      /project repository/
    );
    expect(await write(path.join(orchestratorDir(w.id), "a.md"))).toBeNull();
    expect(await write(at("notes/ok.md"))).toBeNull();
    // Other tools aren't its business.
    expect(
      await orchestratorToolRefusal(o, "Read", { file_path: repo })
    ).toBeNull();
    expect(await orchestratorToolRefusal(o, "Write", {})).toMatch(
      /No file path/
    );
  });

  it("is the guard its chat worker starts with", async () => {
    const { orchestratorExtras } = await import("./worker");
    const w = createWorkspace("Wired");
    const o = ensureOrchestrator(w.id);
    fs.mkdirSync(at("dev/wired"), { recursive: true });
    createProject({
      name: "wired",
      workingDirectory: at("dev/wired"),
      workspaceId: w.id,
    });
    const extras = await orchestratorExtras(o);
    expect(extras.allowedTools).toContain("Write");
    expect(
      await extras.toolGuard!("Write", { file_path: at("dev/wired/a.ts") })
    ).toMatch(/project repository/);
    expect(
      await extras.toolGuard!("Edit", { file_path: at("notes/ok.md") })
    ).toBeNull();
  });

  it("are refused in PATH, XDG config, ~/Library and the usage brake's folder", async () => {
    const outside = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "aos-wg-path-"))
    );
    for (const d of ["bin", "xdg"]) fs.mkdirSync(path.join(outside, d));
    vi.stubEnv("PATH", `${path.join(outside, "bin")}:relative/bin`);
    vi.stubEnv("XDG_CONFIG_HOME", path.join(outside, "xdg"));
    try {
      const o = ensureOrchestrator(createWorkspace("Runs").id);
      const write = (file_path: string) =>
        orchestratorToolRefusal(o, "Write", { file_path });
      for (const p of [
        path.join(outside, "bin/aos"),
        path.join(outside, "xdg/git/config"),
        at("Library/LaunchAgents/x.plist"),
        "/Library/LaunchAgents/x.plist",
        "/Library/LaunchDaemons/x.plist",
        path.join(path.dirname(LIMITS_FILE), "limits.json"),
      ])
        expect(await write(p), p).toMatch(/configures what runs/);
      expect(await write(path.join(outside, "notes.md"))).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("are refused in a project's core.hooksPath, even outside the repo", async () => {
    // Registered at a folder below the repo's top, as in a monorepo: git
    // takes a relative hooksPath from the top, not from the project.
    const top = at("dev/hooked");
    const repo = path.join(top, "web");
    fs.mkdirSync(repo, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: top });
    execFileSync("git", ["config", "core.hooksPath", "../hooked-hooks"], {
      cwd: top,
    });
    const w = createWorkspace("Hooked");
    createProject({
      name: "hooked",
      workingDirectory: repo,
      workspaceId: w.id,
    });
    const o = ensureOrchestrator(w.id);
    expect(
      await orchestratorToolRefusal(o, "Write", {
        file_path: at("dev/hooked-hooks/pre-commit"),
      })
    ).toContain(`in ${at("dev/hooked-hooks")}`);
    expect(
      await orchestratorToolRefusal(o, "Write", {
        file_path: at("dev/hooked/hooked-hooks/notes.md"),
      })
    ).toBeNull();
  });

  it("refuses, and caches nothing, when git's hooks folder can't be read", async () => {
    const { hooksPaths } = await import("./write-guard");
    const notRepo = at("dev/plain");
    fs.mkdirSync(notRepo, { recursive: true });
    // Not a repository, or gone: nothing to protect.
    expect(await hooksPaths([notRepo, at("dev/gone")])).toEqual(
      expect.not.arrayContaining([expect.stringContaining("dev/plain")])
    );
    // The user's own, from their git config, wherever it points.
    const config = at("notes/gitconfig");
    fs.writeFileSync(config, "[core]\n\thooksPath = ~/global-hooks\n");
    vi.stubEnv("GIT_CONFIG_GLOBAL", config);
    // git expands ~ from HOME.
    vi.stubEnv("HOME", home);
    try {
      expect(await hooksPaths([at("dev/plain"), "global"])).toContain(
        at("global-hooks")
      );
    } finally {
      vi.unstubAllEnvs();
    }
    // A folder git can't run in at all (a file where a folder should be).
    fs.writeFileSync(at("dev/not-a-dir"), "");
    await expect(hooksPaths([at("dev/not-a-dir")])).rejects.toThrow(
      /couldn't read git's hooks folder/
    );
  });

  it("runs as a PreToolUse hook on every tool call", async () => {
    const guard = vi.fn(async () => "no");
    const approvals = () =>
      new Approvals(
        () => {},
        () => undefined
      );
    const hooks = preToolUseHooks(approvals(), guard);
    const last = hooks[hooks.length - 1];
    expect(last.matcher).toBeUndefined();
    expect(
      await last.hooks[0](
        {
          hook_event_name: "PreToolUse",
          tool_name: "Write",
          tool_input: { file_path: "/x" },
        } as never,
        "t",
        { signal: new AbortController().signal }
      )
    ).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    expect(guard).toHaveBeenCalledWith("Write", { file_path: "/x" });
    expect(preToolUseHooks(approvals())).toHaveLength(2);
  });

  it("refuses through the PreToolUse hook, and when the guard fails", async () => {
    const run = (guard: Parameters<typeof guardHook>[0], tool = "Write") =>
      guardHook(guard)(
        {
          hook_event_name: "PreToolUse",
          tool_name: tool,
          tool_input: { file_path: "/x" },
          tool_use_id: "t",
          session_id: "s",
          transcript_path: "",
          cwd: "/",
        } as never,
        "t",
        { signal: new AbortController().signal }
      );
    expect(await run(async () => null)).toEqual({});
    expect(await run(async () => "no")).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: "deny",
        permissionDecisionReason: "no",
      },
    });
    expect(
      await run(async () => {
        throw new Error("boom");
      })
    ).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringMatching(/boom/),
      },
    });
  });
});
