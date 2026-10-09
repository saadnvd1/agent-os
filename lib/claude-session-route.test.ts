import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// What reaches child_process: the route must pass tmux an argument array,
// and a bad id must never reach it at all.
const calls = vi.hoisted(() => [] as { file: string; args: string[] }[]);
// What each command answers: its stdout, or null to fail.
const answer = vi.hoisted(() => ({
  fn: (_file: string, _args: string[]): string | null => null,
}));
vi.mock("child_process", async (original) => {
  const real = await original<typeof import("child_process")>();
  type Callback = (
    e: Error | null,
    out: { stdout: string; stderr: string }
  ) => void;
  // execFile(file, args, [options], callback), as promisify calls it.
  const execFile = (file: string, args: string[], ...rest: unknown[]) => {
    const cb = rest.at(-1) as Callback;
    calls.push({ file, args });
    const out = answer.fn(file, args);
    if (out === null) cb(new Error("failed"), { stdout: "", stderr: "" });
    else cb(null, { stdout: out, stderr: "" });
  };

  return { ...real, default: { ...real, execFile }, execFile };
});

const { GET } = await import("@/app/api/sessions/[id]/claude-session/route");
const { POST: createPr } = await import("@/app/api/sessions/[id]/pr/route");
const { db } = await import("@/lib/db");
const ask = (id: string) =>
  GET(new Request("http://x"), { params: Promise.resolve({ id }) });

beforeEach(() => {
  calls.length = 0;
  answer.fn = () => null;
});

describe("GET /api/sessions/[id]/claude-session", () => {
  it.each([
    'x" ; touch /tmp/pwned ; "',
    "$(id)",
    "a`id`",
    "-t",
    "x y",
    "a".repeat(65),
  ])("refuses the id %j without running anything", async (id) => {
    const res = await ask(id);
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("asks tmux for an exact session with an argument array", async () => {
    const id = "6c1a585a-5a7b-4c3b-80e9-90f6fac0267b";
    const res = await ask(id);
    expect(await res.json()).toEqual({ claude_session_id: null });
    expect(calls).toEqual([
      {
        file: "tmux",
        args: ["show-environment", "-t", `=claude-${id}`, "CLAUDE_SESSION_ID"],
      },
    ]);
  });
});

describe("GET /api/sessions/[id]/claude-session, tmux answering", () => {
  it("reports and saves the session id tmux holds", async () => {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory) VALUES (?, 's', ?, '/tmp')`
    ).run(id, `claude-${id}`);
    answer.fn = () => "CLAUDE_SESSION_ID=abc-123\n";
    expect(await (await ask(id)).json()).toEqual({
      claude_session_id: "abc-123",
    });
    const row = db
      .prepare(`SELECT claude_session_id FROM sessions WHERE id = ?`)
      .get(id) as { claude_session_id: string };
    expect(row.claude_session_id).toBe("abc-123");
  });

  it("reports none when the variable is unset", async () => {
    answer.fn = () => "-CLAUDE_SESSION_ID\n";
    expect(await (await ask(randomUUID())).json()).toEqual({
      claude_session_id: null,
    });
  });
});

describe("POST /api/sessions/[id]/pr", () => {
  it("passes the title, branch and empty body to gh and git as single arguments", async () => {
    const id = randomUUID();
    const branch = '-x"; touch /tmp/p; "';
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, worktree_path, branch_name, base_branch)
       VALUES (?, 's', ?, '/tmp', '/tmp', ?, 'main')`
    ).run(id, `claude-${id}`, branch);
    answer.fn = (file, args) =>
      file === "gh" && args[1] === "list"
        ? "[]"
        : file === "gh" && args[1] === "create"
          ? JSON.stringify({ number: 1, url: "u", state: "OPEN", title: "t" })
          : "";
    const title = 'x" ; touch /tmp/p ; "';
    const res = await createPr(
      new NextRequest("http://x", {
        method: "POST",
        body: JSON.stringify({ title }),
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(201);
    expect(calls).toContainEqual({
      file: "git",
      args: ["push", "-u", "origin", "--", branch],
    });
    expect(calls).toContainEqual({
      file: "gh",
      args: [
        "pr",
        "create",
        "--title",
        title,
        "--base",
        "main",
        "--body",
        "",
        "--json",
        "number,url,state,title",
      ],
    });
    expect(calls.find((c) => c.args[1] === "list")?.args).toContain(branch);
  });
});
