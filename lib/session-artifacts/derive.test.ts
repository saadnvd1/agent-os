import { describe, expect, it } from "vitest";
import {
  artifactId,
  fromItems,
  fromPr,
  fromRun,
  fromStatus,
  mergePlan,
  parsePorcelain,
  resolvePath,
  stateOf,
  toArtifact,
  toolPaths,
  type ItemRow,
} from "./derive";

const HOME = "/home/u";
const CWD = "/home/u/.agent-os/worktrees/proj-x";
let n = 0;
const tool = (name: string, input: Partial<ItemRow>, at = ++n): ItemRow => ({
  item_id: `i${at}`,
  kind: "tool",
  at,
  name,
  status: "done",
  ...input,
});

describe("fromItems", () => {
  it("groups every edit of one file into a row with its count and last time", () => {
    const rows = [
      tool("Write", { file_path: "src/a.ts" }, 1),
      tool("Edit", { file_path: `${CWD}/src/a.ts` }, 2),
      tool("Edit", { file_path: "./src/a.ts" }, 5),
      tool("MultiEdit", { file_path: "src/a.ts" }, 3),
    ];
    const [a] = fromItems(rows, CWD, HOME);
    expect(a).toMatchObject({
      key: `file:${CWD}/src/a.ts`,
      kind: "file",
      name: "a.ts",
      edits: 4,
      at: 5,
    });
  });

  it("reads each driver's own way of naming the file", () => {
    const rows = [
      tool("NotebookEdit", { notebook_path: "nb.ipynb" }),
      tool("write", { input_path: "pi.md" }),
      tool("Edit", { changes: JSON.stringify(["c1.ts", "c2.ts"]) }),
    ];
    expect(
      fromItems(rows, CWD, HOME)
        .map((c) => c.name)
        .sort()
    ).toEqual(["c1.ts", "c2.ts", "nb.ipynb", "pi.md"]);
  });

  it("leaves out reads, failed calls and secrets", () => {
    const rows = [
      tool("Read", { file_path: "src/b.ts" }),
      tool("Grep", { input_path: "src" }),
      { ...tool("Write", { file_path: "src/c.ts" }), status: "error" },
      tool("Write", { file_path: ".env" }),
      tool("Write", { file_path: "~/.ssh/id_ed25519" }),
      tool("Edit", { file_path: "config/secrets.json" }),
      tool("Write", { file_path: "certs/server.pem" }),
    ];
    expect(fromItems(rows, CWD, HOME)).toEqual([]);
  });

  it("takes a screenshot tool's image, never its other files", () => {
    const rows = [
      tool("mcp__chrome-devtools__take_screenshot", {
        file_path_camel: "/tmp/shot.png",
      }),
      tool("mcp__chrome-devtools__take_snapshot", {
        file_path_camel: "/tmp/dom.txt",
      }),
      tool("mcp__chrome-devtools__upload_file", {
        file_path_camel: "/tmp/up.png",
      }),
    ];
    const out = fromItems(rows, CWD, HOME);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "image", name: "shot.png" });
    expect(out[0].edits).toBeUndefined();
  });

  it("lists rendered pages, attached images, shell jobs and the chat's plan", () => {
    const rows: ItemRow[] = [
      {
        item_id: "p",
        kind: "artifact",
        at: 1,
        artifact_id: "a-1",
        title: "Timing",
      },
      { item_id: "u", kind: "user", at: 2, image_count: 2 },
      { item_id: "u2", kind: "user", at: 3, image_count: null },
      {
        item_id: "t1",
        kind: "task",
        at: 4,
        task_id: "b1",
        task_type: "local_bash",
        description: "npm test",
        output_file: "/tmp/b1.output",
        status: "completed",
      },
      {
        item_id: "t2",
        kind: "task",
        at: 5,
        task_id: "s1",
        task_type: "local_agent",
        subagent_type: "Explore",
      },
      {
        item_id: "t3",
        kind: "task",
        at: 6,
        task_id: "b2",
        task_type: "local_bash",
        ambient: 1,
      },
      { item_id: "pl", kind: "plan", at: 7 },
    ];
    const out = fromItems(rows, CWD, HOME);
    expect(out.map((c) => [c.kind, c.name, c.by])).toEqual([
      ["page", "Timing", undefined],
      ["image", "Attached image 1", "you"],
      ["image", "Attached image 2", "you"],
      ["log", "npm test", undefined],
      ["plan", "Plan", undefined],
    ]);
    expect(out[3].source).toEqual({
      type: "log",
      taskId: "b1",
      path: "/tmp/b1.output",
    });
  });
});

describe("toolPaths", () => {
  it("ignores a path that isn't a write", () => {
    expect(toolPaths(tool("Glob", { input_path: "src" }))).toEqual([]);
  });
});

describe("resolvePath", () => {
  it("expands ~ and resolves relative paths against the session's folder", () => {
    expect(resolvePath("~/x.md", CWD, HOME)).toBe("/home/u/x.md");
    expect(resolvePath("../y.md", CWD, HOME)).toBe(
      "/home/u/.agent-os/worktrees/y.md"
    );
    expect(resolvePath("rel.md", null, HOME)).toBeNull();
    expect(resolvePath("a\0b", CWD, HOME)).toBeNull();
  });
});

describe("git status", () => {
  it("parses porcelain -z, skipping deletions and a rename's old path", () => {
    const out =
      [
        "?? out.txt",
        " M src/a.ts",
        " D gone.ts",
        "R  new.ts",
        "old.ts",
        "?? dir/",
      ].join("\0") + "\0";
    expect(parsePorcelain(out)).toEqual(["out.txt", "src/a.ts", "new.ts"]);
  });

  it("adds only files the tools didn't already name, as made by a shell", () => {
    const known = new Set([`file:${CWD}/src/a.ts`]);
    const out = fromStatus(
      ["src/a.ts", "out.txt", ".env.local"],
      CWD,
      9,
      known
    );
    expect(out.map((c) => [c.name, c.by])).toEqual([["out.txt", "shell"]]);
  });
});

describe("mergePlan", () => {
  it("makes the plan file and the chat's plan one row", () => {
    const plan = `${CWD}/.agentos/plan.md`;
    const merged = mergePlan(
      [
        {
          key: `file:${plan}`,
          kind: "file",
          name: "plan.md",
          at: 3,
          edits: 2,
          source: { type: "file", path: plan },
        },
        {
          key: "plan",
          kind: "plan",
          name: "Plan",
          at: 5,
          source: { type: "plan", chatItemId: "c" },
        },
      ],
      plan
    );
    expect(merged).toEqual([
      {
        key: "plan",
        kind: "plan",
        name: "Plan",
        at: 5,
        edits: 2,
        source: { type: "plan", path: plan, chatItemId: "c" },
      },
    ]);
  });
});

describe("rows from the session", () => {
  it("has a PR only when there is one", () => {
    expect(
      fromPr({ pr_url: null, pr_number: null, pr_status: null, at: 0 })
    ).toBeNull();
    expect(
      fromPr({
        pr_url: "https://github.com/o/r/pull/7",
        pr_number: 7,
        pr_status: "merged",
        at: 1,
      })
    ).toMatchObject({
      name: "PR #7",
      detail: "merged",
      url: "https://github.com/o/r/pull/7",
    });
    expect(
      fromRun({ id: 3, recipe_name: "Nightly", status: "done", at: 2 }).name
    ).toBe("Recipe run: Nightly");
  });
});

describe("state", () => {
  it("says where a file is: there, kept, in the PR, gone or outside", () => {
    expect(stateOf({ size: 10, allowed: true })).toEqual({
      state: "live",
      size: 10,
    });
    expect(stateOf({ size: 10, allowed: false })).toEqual({
      state: "outside",
      size: 10,
    });
    expect(stateOf({ allowed: true, keptSize: 4 })).toEqual({
      state: "kept",
      size: 4,
    });
    expect(stateOf({ allowed: true, committed: true })).toEqual({
      state: "in-pr",
    });
    expect(stateOf({ allowed: true })).toEqual({ state: "gone" });
  });

  it("gives stable ids, a preview by type and ~ paths", () => {
    const c = {
      key: `file:${HOME}/r/x.md`,
      kind: "file" as const,
      name: "x.md",
      at: 1,
      source: { type: "file" as const, path: `${HOME}/r/x.md` },
    };
    const a = toArtifact(
      c,
      {
        state: "live",
        size: 3,
        path: `${HOME}/r/x.md`,
        read: `${HOME}/r/x.md`,
      },
      HOME
    );
    expect(a.artifact).toMatchObject({
      id: artifactId(c.key),
      path: "~/r/x.md",
      preview: "markdown",
      size: 3,
    });
    expect(a.artifact.id).toMatch(/^[0-9a-f]{16}$/);
    expect(
      toArtifact(c, { state: "live", path: "/x/page.html" }, HOME).artifact
        .preview
    ).toBe("html");
    expect(
      toArtifact(c, { state: "live", path: "/x/a.png" }, HOME).artifact.preview
    ).toBe("image");
    expect(
      toArtifact(c, { state: "live", path: "/x/a.log" }, HOME).artifact.preview
    ).toBe("text");
    // What the server reads never goes out with the artifact.
    expect(JSON.stringify(a.artifact)).not.toContain("read");
  });
});
