import { describe, expect, it } from "vitest";
import { ENV_CLASSES } from "./classes";
import { classifyToolResult, type ToolResult } from "./classify";

const bash = (
  command: string,
  output: string,
  status = "error"
): ToolResult => ({
  tool: "Bash",
  input: { command },
  output,
  status,
});

const TRACE = (tail: string) =>
  `Traceback (most recent call last):\n  File "run.py", line 1, in <module>\n${tail}`;

const positives: [string, ToolResult, string][] = [
  [
    "python-missing-module",
    bash(
      "python3 apps/x/run.py",
      TRACE("ModuleNotFoundError: No module named 'dashkit'")
    ),
    "ModuleNotFoundError",
  ],
  [
    "python-version",
    bash(
      "python3 tool.py",
      TRACE("ModuleNotFoundError: No module named 'tomllib'")
    ),
    "tomllib",
  ],
  [
    "python-version",
    bash(
      "python3 tool.py",
      `  File "/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9/x.py", line 3\n    match x:\nSyntaxError: invalid syntax`
    ),
    "SyntaxError",
  ],
  [
    "python-externally-managed",
    bash("pip install requests", "error: externally-managed-environment"),
    "externally",
  ],
  [
    "python-not-found",
    bash("python x.py", "zsh: command not found: python"),
    "not found",
  ],
  [
    "local-permission",
    bash("mkdir /x/y", "mkdir: /x/y: Permission denied"),
    "Permission",
  ],
  [
    "macos-automation",
    bash(
      "osascript -e 'tell app \"Mail\" to count accounts'",
      "execution error: Not authorized to send Apple events to Mail. (-1743)"
    ),
    "Apple events",
  ],
  [
    "guard-git-write",
    bash("git pull -q", "Refused: git pull would change /repo. No."),
    "git pull",
  ],
  [
    "guard-git-write",
    {
      tool: "Write",
      input: { file_path: "/r/a.ts" },
      status: "error",
      output:
        "/r/a.ts is inside /r, a project repository, task worktree or AgentOS itself.",
    },
    "inside",
  ],
  [
    "guard-write",
    {
      tool: "Edit",
      input: { file_path: "/r/a" },
      status: "error",
      output: "/r/a holds or guards secrets; orchestrators never write those.",
    },
    "never write",
  ],
  [
    "guard-shell",
    bash(
      "sqlite3 x.db .tables",
      "Refused: sqlite3 on AgentOS's own state; use the tools."
    ),
    "sqlite3",
  ],
];

describe("the class table", () => {
  it.each(positives)("%s: %#", (cls, result) => {
    expect(classifyToolResult(result)?.class).toBe(cls);
  });

  it("has unique ids, and a positive case for every class", () => {
    const ids = ENV_CLASSES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(positives.some((p) => p[0] === id)).toBe(true);
  });

  it("stores a scrubbed line and command", () => {
    const hit = classifyToolResult(
      bash(
        "cd /repo && API_TOKEN=abc python3 run.py",
        TRACE("ModuleNotFoundError: No module named 'dashkit'")
      )
    );
    expect(hit?.line).toBe("ModuleNotFoundError: No module named 'dashkit'");
    expect(hit?.command).not.toContain("abc");
  });
});

describe("what is not a failure", () => {
  const out = TRACE("ModuleNotFoundError: No module named 'dashkit'");
  it.each([
    [
      "grepping for the error text",
      bash('grep -rn "No module named" ~/logs', out, "done"),
    ],
    ["rg for it", bash("rg ModuleNotFoundError notes.md", out, "done")],
    ["reading a log", bash("cat server.log | head -50", out, "done")],
    [
      "a Read tool holding a traceback",
      {
        tool: "Read",
        input: { file_path: "/a.log" },
        output: out,
        status: "done",
      },
    ],
    [
      "a SyntaxError from the repo's own code",
      bash("python3 x.py", `File "x.py", line 3\nSyntaxError: invalid syntax`),
    ],
    [
      "a remote permission error",
      bash("ssh box ls /var/lib/x", "ls: /var/lib/x: Permission denied"),
    ],
    [
      "a publickey failure",
      bash("git push", "git@host: Permission denied (publickey)."),
    ],
    [
      "searching for the Apple events error",
      bash(
        "grep -rn 'Not authorized to send Apple events' .",
        "a.md: Not authorized to send Apple events",
        "done"
      ),
    ],
    [
      "guard source read with status done",
      bash(
        "cat lib/orchestrator/shell-guard.ts",
        "return `Refused: git pull would change`",
        "done"
      ),
    ],
    [
      "a guard phrase on a call that wasn't refused",
      { tool: "Read", input: {}, output: "Refused: git pull", status: "done" },
    ],
    ["empty output", bash("python3 x.py", "")],
  ])("%s", (_name, result) => {
    expect(classifyToolResult(result)).toBeNull();
  });
});
