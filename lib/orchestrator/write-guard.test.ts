import fs from "fs";
import os from "os";
import path from "path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createWorkspace } from "@/lib/workspaces";
import { addProjectRepository, createProject } from "@/lib/projects";
import { guardHook } from "@/lib/chat/drivers/claude-approvals";
import { ensureOrchestrator, orchestratorDir } from "./home";
import {
  orchestratorToolRefusal,
  physicalPath,
  writeRefusal,
  type WriteBounds,
} from "./write-guard";

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
    "notes",
    ".ssh",
  ])
    fs.mkdirSync(at(d), { recursive: true });
  // Ways back into the repo from places that look writable.
  fs.symlinkSync(at("dev/app"), at("notes/app-link"));
  fs.symlinkSync(at("dev/app/src/new.ts"), at("notes/dangling"));
  fs.symlinkSync(at("dev/app/src"), at("notes/deep"));
  fs.symlinkSync(at(".ssh"), at("notes/keys"));
  bounds = {
    cwd: at(".agent-os/orchestrators/w1"),
    ownDir: at(".agent-os/orchestrators/w1"),
    state: at(".agent-os"),
    repos: [at("dev/app"), at(".agent-os/worktrees")],
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
    ])
      expect(await refused(p), p).toMatch(/secrets/);
    expect(await refused(at("notes/environment.md"))).toBeNull();
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
