import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

// What reaches child_process from the routes and helpers that used to build
// shell strings out of request and session data: each value must arrive as
// one argument of its own, and nothing may run through a shell.
// cwd is recorded but not enumerable, so call lists compare on argv alone.
type Call = { file: string; args: string[]; stdin?: string; cwd?: string };
const calls = vi.hoisted(() => [] as Call[]);
const BROKEN_PIPE = vi.hoisted(() => "a paste tmux never finished reading");
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
    const opts = rest.length > 1 ? (rest[0] as { cwd?: string }) : undefined;
    Object.defineProperty(call, "cwd", { value: opts?.cwd, enumerable: false });
    calls.push(call);
    const out = answer.fn(file, args);
    // stdin is written after execFile returns, as a real child's is.
    const stdin = Object.assign(new EventEmitter(), {
      end: (data?: string) => {
        call.stdin = data;
        // tmux gone before reading: the pipe breaks, then the process fails.
        if (data === BROKEN_PIPE) {
          setImmediate(() => {
            stdin.emit(
              "error",
              Object.assign(new Error("EPIPE"), { code: "EPIPE" })
            );
            cb(new Error("killed"), { stdout: "", stderr: "" });
          });
          return;
        }
        setImmediate(() =>
          out === null
            ? cb(new Error("failed"), { stdout: "", stderr: "" })
            : cb(null, { stdout: out, stderr: "" })
        );
      },
    });
    if (!["load-buffer"].includes(args[0])) stdin.end();
    return { stdin };
  };
  const exec = (command: string) => {
    throw new Error(`a shell was asked to run: ${command}`);
  };
  // The summarizer's `claude -p`, which reads the conversation on stdin.
  const spawn = (file: string, args: string[]) => {
    const call: Call = { file, args };
    calls.push(call);
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      write: (data: string) => {
        call.stdin = (call.stdin ?? "") + data;
        return true;
      },
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

const { db, queries } = await import("@/lib/db");
type DevServer = import("@/lib/db").DevServer;
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

  it("answers a broken pipe to tmux with an error, not a crash", async () => {
    const res = await POST(post({ text: BROKEN_PIPE }), params(addSession()));
    expect(res.status).toBe(500);
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

describe("spawnWorker", async () => {
  const { spawnWorker } = await import("@/lib/orchestration");
  const os = await import("os");
  const path = await import("path");

  // Its readiness poll sleeps 2s between looks: run those sleeps on a fake
  // clock, while the mocked processes still answer on real setImmediate.
  async function spawn(task: string, workingDirectory: string) {
    answer.fn = (_file, args) =>
      args[0] === "capture-pane" ? "? for shortcuts\n" : "";
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      let done = false;
      const started = spawnWorker({
        conductorSessionId: addSession(),
        task,
        workingDirectory,
        useWorktree: false,
      }).finally(() => (done = true));
      while (!done) {
        await vi.advanceTimersByTimeAsync(2000);
        await new Promise((r) => setImmediate(r));
      }
      return await started;
    } finally {
      vi.useRealTimers();
    }
  }
  const created = () =>
    tmuxCalls().find((c) => c.args[0] === "new-session")?.args;

  it.each(EVIL)(
    "starts in a hostile directory and sends the task %j as literal keys",
    async (task) => {
      const worker = await spawn(task, `~/${EVIL[0]}`);
      const target = `=${worker.tmux_name}:`;
      expect(created()?.slice(0, 6)).toEqual([
        "new-session",
        "-d",
        "-s",
        worker.tmux_name,
        "-c",
        path.join(os.homedir(), EVIL[0]),
      ]);
      expect(created()).toHaveLength(7);
      expect(tmuxCalls().slice(-2)).toEqual([
        { file: "tmux", args: ["send-keys", "-t", target, "-l", "--", task] },
        { file: "tmux", args: ["send-keys", "-t", target, "Enter"] },
      ]);
    }
  );

  it.each([
    ["~", os.homedir()],
    ["~foo/x", "~foo/x"],
    ["/a~b", "/a~b"],
  ])("expands only a leading ~ or ~/: %j", async (dir, cwd) => {
    await spawn("t", dir);
    expect(created()?.[5]).toBe(cwd);
  });
});

describe("docker dev server reads", async () => {
  const { getServerLogs, getServerStatus, detectDockerServices } =
    await import("@/lib/dev-servers");
  const { createProject } = await import("@/lib/projects");
  const fs = await import("fs");
  const os = await import("os");
  const path = await import("path");
  const project = createProject({ name: "q", workingDirectory: "/tmp" });
  const container = EVIL[1];
  const id = randomUUID();
  db.prepare(
    `INSERT INTO dev_servers (id, project_id, type, name, command, container_id) VALUES (?, ?, 'docker', 'd', 'web', ?)`
  ).run(id, project.id, container);

  it.each([
    [NaN, "0"],
    ["5; touch /tmp/pwned", "0"],
    [-5, "0"],
    [25.7, "25"],
  ])("reads logs with --tail %j as %s", async (lines, tail) => {
    await getServerLogs(id, lines as number);
    expect(calls).toEqual([
      { file: "docker", args: ["logs", "--tail", tail, "--", container] },
    ]);
  });

  it("inspects a container by its stored id, as one argument", async () => {
    answer.fn = () => "running\n";
    const server = queries.getDevServer(db).get(id) as DevServer;
    expect(await getServerStatus(server)).toBe("running");
    expect(calls).toEqual([
      {
        file: "docker",
        args: ["inspect", "-f", "{{.State.Status}}", "--", container],
      },
    ]);
  });

  it("lists a compose file's services in a hostile directory, as the cwd", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "$(touch pwned)"));
    onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, "compose.yml"), "services: {}\n");
    answer.fn = () => "web\n";
    expect(await detectDockerServices(dir)).toEqual([
      expect.objectContaining({ name: "web", command: "web" }),
    ]);
    expect(calls).toEqual([
      {
        file: "docker",
        args: ["compose", "-f", "compose.yml", "config", "--services"],
      },
    ]);
    expect(calls[0].cwd).toBe(dir);
  });

  it("checks a node server's ports with lsof's arguments only", async () => {
    const nodeId = randomUUID();
    db.prepare(
      `INSERT INTO dev_servers (id, project_id, type, name, command, ports) VALUES (?, ?, 'node', 'n', 'npm run dev', '[3123]')`
    ).run(nodeId, project.id);
    answer.fn = () => "4242\n4343\n";
    const server = queries.getDevServer(db).get(nodeId) as DevServer;
    expect(await getServerStatus(server)).toBe("running");
    expect(calls).toEqual([
      { file: "lsof", args: ["-t", "-i", ":3123"] },
      { file: "lsof", args: ["-t", "-i", ":3123"] },
    ]);
    expect((queries.getDevServer(db).get(nodeId) as DevServer).pid).toBe(4242);
  });
});

describe("summarize reads Claude's session id as an id", async () => {
  const { POST } = await import("@/app/api/sessions/[id]/summarize/route");
  const fs = await import("fs");
  const os = await import("os");
  const path = await import("path");

  // A home of our own, with a transcript planted wherever each id would
  // lead: only a plain id may be read.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "summarize-home-"));
  const projects = path.join(home, ".claude", "projects", "-tmp");
  const line = (text: string) =>
    JSON.stringify({ type: "user", message: { content: text } });
  const plant = (id: string, text: string) => {
    const file = path.join(projects, `${id}.jsonl`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${line(text.repeat(40))}\n`);
  };

  async function summarize(claudeId: string) {
    const realHome = process.env.HOME;
    process.env.HOME = home;
    try {
      answer.fn = (_file, args) =>
        args[0] === "show-environment"
          ? `CLAUDE_SESSION_ID=${claudeId}\n`
          : args[0] === "capture-pane"
            ? "short"
            : null;
      return await POST(post({ createFork: false }), params(addSession()));
    } finally {
      process.env.HOME = realHome;
    }
  }
  const claude = () => calls.find((c) => c.file === "claude");

  it.each(["../../escaped", "a/b", "$(id)"])(
    "won't read the transcript %j points at",
    async (claudeId) => {
      plant(claudeId, "PLANTED ");
      const res = await summarize(claudeId);
      expect(res.status).toBe(400);
      expect(claude()).toBeUndefined();
    }
  );

  it("reads a plain id's transcript", async () => {
    plant("abc-123", "REAL ");
    const res = await summarize("abc-123");
    expect(res.status).toBe(200);
    expect(claude()?.stdin).toContain("REAL REAL");
  });
});

describe("POST /api/git/commit", async () => {
  const { POST } = await import("@/app/api/git/commit/route");

  // A repository on main with one file staged, as far as the reads go; a
  // checkout or commit that ran would be recorded.
  beforeEach(() => {
    answer.fn = (_file, args) =>
      args.includes("rev-parse")
        ? ".git\n"
        : args.includes("status")
          ? "A  staged.txt\n"
          : args.includes("--show-current")
            ? "main\n"
            : "";
  });

  it.each(["-f", "--orphan=x", "x; touch /tmp/pwned", ["a"]])(
    "refuses the branch %j with its own reason, running nothing",
    async (branchName) => {
      const res = await POST(post({ path: "/tmp", message: "m", branchName }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid branch name" });
      expect(calls.filter((c) => c.args.includes("checkout"))).toEqual([]);
      expect(calls.filter((c) => c.args.includes("commit"))).toEqual([]);
    }
  );

  it("refuses a message that isn't a string", async () => {
    const res = await POST(post({ path: "/tmp", message: ["m"] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Commit message is required" });
    expect(calls).toEqual([]);
  });
});
