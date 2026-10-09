import { beforeEach, describe, expect, it, vi } from "vitest";

// What reaches child_process: the route must pass tmux an argument array,
// and a bad id must never reach it at all.
const calls = vi.hoisted(() => [] as { file: string; args: string[] }[]);
vi.mock("child_process", async (original) => {
  const real = await original<typeof import("child_process")>();
  const execFile = (
    file: string,
    args: string[],
    cb: (e: Error | null, out: { stdout: string; stderr: string }) => void
  ) => {
    calls.push({ file, args });
    cb(new Error("no server"), { stdout: "", stderr: "" });
  };
  return { ...real, default: { ...real, execFile }, execFile };
});

const { GET } = await import("@/app/api/sessions/[id]/claude-session/route");
const ask = (id: string) =>
  GET(new Request("http://x"), { params: Promise.resolve({ id }) });

beforeEach(() => (calls.length = 0));

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
