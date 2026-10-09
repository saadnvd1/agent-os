import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// What reaches child_process from the routes and helpers that used to build
// shell strings out of request and session data: each value must arrive as
// one argument of its own, and nothing may run through a shell.
type Call = { file: string; args: string[]; stdin?: string };
const calls = vi.hoisted(() => [] as Call[]);
const answer = vi.hoisted(() => ({
  fn: (_file: string, _args: string[]): string | null => "",
}));
vi.mock("child_process", async (original) => {
  const real = await original<typeof import("child_process")>();
  type Callback = (
    e: Error | null,
    out: { stdout: string; stderr: string }
  ) => void;
  const execFile = (file: string, args: string[], ...rest: unknown[]) => {
    const cb = rest.at(-1) as Callback;
    const call: Call = { file, args };
    calls.push(call);
    const out = answer.fn(file, args);
    // stdin is written after execFile returns, as a real child's is.
    const stdin = {
      end: (data?: string) => {
        call.stdin = data;
        setImmediate(() =>
          out === null
            ? cb(new Error("failed"), { stdout: "", stderr: "" })
            : cb(null, { stdout: out, stderr: "" })
        );
      },
    };
    if (!["load-buffer"].includes(args[0])) stdin.end();
    return { stdin };
  };
  const exec = (command: string) => {
    throw new Error(`a shell was asked to run: ${command}`);
  };
  // The summarizer's `claude -p`, which reads the conversation on stdin.
  const spawn = (file: string, args: string[]) => {
    calls.push({ file, args });
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      write: () => true,
      end: () =>
        setImmediate(() => {
          (child.stdout as EventEmitter).emit("data", "the summary");
          child.emit("close", 0);
        }),
    };
    return child;
  };
  const mocked = { ...real, execFile, exec, spawn };
  return { ...mocked, default: mocked };
});

const { db } = await import("@/lib/db");
const { createHost } = await import("@/lib/hosts");
const { loginShellCommand } = await import("@/lib/hosts/ssh");

const EVIL = [
  'x" ; touch /tmp/pwned ; "',
  "$(touch /tmp/pwned)",
  "`touch /tmp/pwned`",
  "--output=/tmp/x",
];

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) =>
  new NextRequest("http://x", { method: "POST", body: JSON.stringify(body) });
const tmuxCalls = () => calls.filter((c) => c.file === "tmux");

function addSession(fields: Record<string, unknown> = {}): string {
  const id = randomUUID();
  const row = {
    id,
    name: "s",
    tmux_name: `claude-${id}`,
    working_directory: "/tmp",
    agent_type: "claude",
    ...fields,
  };
  const keys = Object.keys(row);
  db.prepare(
    `INSERT INTO sessions (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`
  ).run(...Object.values(row));
  return id;
}

beforeEach(() => {
  calls.length = 0;
  answer.fn = () => "";
});

describe("POST /api/sessions/[id]/send-keys", async () => {
  const { POST } = await import("@/app/api/sessions/[id]/send-keys/route");

  it.each(EVIL)("pastes %j as text, on stdin", async (text) => {
    const tmuxName = `claude-${EVIL[0]}`;
    const id = addSession({ tmux_name: tmuxName });
    const res = await POST(post({ text }), params(id));
    expect(res.status).toBe(200);
    expect(tmuxCalls()).toEqual([
      { file: "tmux", args: ["has-session", "-t", `=${tmuxName}`] },
      {
        file: "tmux",
        args: ["load-buffer", "-b", `send-${id}`, "-"],
        stdin: text,
      },
      {
        file: "tmux",
        args: ["paste-buffer", "-d", "-b", `send-${id}`, "-t", `=${tmuxName}:`],
      },
      { file: "tmux", args: ["send-keys", "-t", `=${tmuxName}:`, "Enter"] },
    ]);
  });

  it("refuses text that isn't a string", async () => {
    const res = await POST(post({ text: ["a"] }), params(addSession()));
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe("POST /api/tmux/rename", async () => {
  const { POST } = await import("@/app/api/tmux/rename/route");

  it.each(EVIL)("renames with %j as one argument", async (evil) => {
    await POST(post({ oldName: evil, newName: evil }));
    expect(calls).toEqual([
      { file: "tmux", args: ["rename-session", "-t", `=${evil}`, "--", evil] },
    ]);
  });
});

describe("GET /api/sessions/[id]/preview", async () => {
  const { GET } = await import("@/app/api/sessions/[id]/preview/route");

  it.each(EVIL)(
    "captures the pane of an unknown id %j as one argument",
    async (id) => {
      answer.fn = () => "line\n";
      const res = await GET(new NextRequest("http://x"), params(id));
      expect(res.status).toBe(200);
      expect(calls).toEqual([
        {
          file: "tmux",
          args: ["capture-pane", "-t", `=claude-${id}:`, "-p", "-S", "-100"],
        },
      ]);
    }
  );
});

describe("PATCH /api/sessions/[id] rename", async () => {
  const { PATCH } = await import("@/app/api/sessions/[id]/route");

  it("renames a tmux session whose stored name is shell syntax, as a name", async () => {
    const id = addSession({ tmux_name: EVIL[1] });
    const req = new NextRequest("http://x", {
      method: "PATCH",
      body: JSON.stringify({ name: "fresh name" }),
    });
    await PATCH(req, params(id));
    const rename = tmuxCalls().find((c) => c.args[0] === "rename-session");
    expect(rename?.args.slice(0, 4)).toEqual([
      "rename-session",
      "-t",
      `=${EVIL[1]}`,
      "--",
    ]);
    expect(rename?.args).toHaveLength(5);
  });
});

describe("POST /api/projects on another machine", async () => {
  const { POST } = await import("@/app/api/projects/route");
  const host = createHost("box", "user@box");

  it.each(EVIL)("checks %j as a quoted path on that machine", async (dir) => {
    await POST(post({ name: "p", workingDirectory: dir, hostId: host.id }));
    const ssh = calls.filter((c) => c.file === "ssh");
    expect(ssh).toHaveLength(1);
    const quoted = `'${dir.replace(/'/g, `'\\''`)}'`;
    expect(ssh[0].args.at(-1)).toBe(
      loginShellCommand(`test -d ${quoted} && echo ok || true`)
    );
  });

  it("leaves a leading ~ to that machine's home", async () => {
    await POST(post({ name: "p", workingDirectory: "~/a b", hostId: host.id }));
    expect(calls[0].args.at(-1)).toBe(
      loginShellCommand(`test -d "$HOME"/'a b' && echo ok || true`)
    );
  });
});

describe("POST /api/sessions/[id]/summarize", async () => {
  const { POST } = await import("@/app/api/sessions/[id]/summarize/route");

  it("starts the fresh session in a working directory that is shell syntax, as a directory", async () => {
    const cwd = `/tmp/${EVIL[0]}`;
    const id = addSession({ working_directory: cwd });
    answer.fn = (_file, args) =>
      args[0] === "capture-pane"
        ? "a conversation long enough to summarize. ".repeat(5)
        : args[0] === "display-message"
          ? null
          : "";
    const res = await POST(post({ sendContext: false }), params(id));
    expect(res.status).toBe(200);
    const created = tmuxCalls().find((c) => c.args[0] === "new-session");
    expect(created?.args.slice(0, 6)).toEqual([
      "new-session",
      "-d",
      "-s",
      expect.stringMatching(/^claude-[0-9a-f-]{36}$/),
      "-c",
      cwd,
    ]);
    expect(created?.args).toHaveLength(7);
    expect(tmuxCalls().slice(0, 2)).toEqual([
      {
        file: "tmux",
        args: [
          "display-message",
          "-t",
          `=claude-${id}:`,
          "-p",
          "#{pane_current_path}",
        ],
      },
      {
        file: "tmux",
        args: ["show-environment", "-t", `=claude-${id}`, "CLAUDE_SESSION_ID"],
      },
    ]);
  }, 10_000);
});

describe("orchestration workers", async () => {
  const { sendToWorker, getWorkerOutput, killWorker } =
    await import("@/lib/orchestration");

  it.each(EVIL)("sends %j to a worker as literal keys", async (message) => {
    const id = addSession({ tmux_name: EVIL[2] });
    expect(await sendToWorker(id, message)).toBe(true);
    expect(calls).toEqual([
      {
        file: "tmux",
        args: ["send-keys", "-t", `=${EVIL[2]}:`, "-l", "--", message],
      },
      { file: "tmux", args: ["send-keys", "-t", `=${EVIL[2]}:`, "Enter"] },
    ]);
  });

  it("reads a worker's output with a numeric line count only", async () => {
    const id = addSession({ tmux_name: EVIL[0] });
    await getWorkerOutput(id, "5; touch /tmp/pwned" as unknown as number);
    expect(calls).toEqual([
      {
        file: "tmux",
        args: ["capture-pane", "-t", `=${EVIL[0]}:`, "-p", "-S", "-0"],
      },
    ]);
  });

  it("kills a worker by its stored name, as a name", async () => {
    const id = addSession({ tmux_name: EVIL[1] });
    await killWorker(id);
    expect(calls).toEqual([
      { file: "tmux", args: ["kill-session", "-t", `=${EVIL[1]}`] },
    ]);
  });
});

describe("docker dev servers", async () => {
  const { startServer, stopServer } = await import("@/lib/dev-servers");
  const { createProject } = await import("@/lib/projects");
  const project = createProject({ name: "p", workingDirectory: "/tmp" });
  const start = (command: string) =>
    startServer({
      projectId: project.id,
      type: "docker",
      name: "d",
      command,
      workingDirectory: "/tmp",
    });

  it.each(EVIL)("won't start the compose service %j", async (service) => {
    const server = await start(service);
    expect(calls).toEqual([]);
    expect(server.container_id).toBeNull();
  });

  it("starts, then stops, a service by name with argument arrays", async () => {
    answer.fn = (_file, args) => (args[1] === "ps" ? `${EVIL[3]}\n` : "");
    const server = await start("web");
    expect(calls).toEqual([
      { file: "docker", args: ["compose", "up", "-d", "--", "web"] },
      { file: "docker", args: ["compose", "ps", "-q", "--", "web"] },
    ]);
    calls.length = 0;
    await stopServer(server.id);
    expect(calls).toEqual([{ file: "docker", args: ["stop", "--", EVIL[3]] }]);
  });
});

describe("POST /api/tmux/kill-all", async () => {
  const { POST } = await import("@/app/api/tmux/kill-all/route");

  it("kills only managed sessions, each by exact name in an argument array", async () => {
    const name = `claude-${randomUUID()}`;
    answer.fn = (_file, args) =>
      args[0] === "list-sessions"
        ? `${name}\nclaude-x";touch /tmp/pwned;"\nnot-ours\n`
        : "";
    await POST();
    expect(calls).toEqual([
      { file: "tmux", args: ["list-sessions", "-F", "#{session_name}"] },
      { file: "tmux", args: ["kill-session", "-t", `=${name}`] },
    ]);
  });
});
