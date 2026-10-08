import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Every pty the handler starts, by what it ran.
const ptys = vi.hoisted(
  () =>
    [] as {
      file: string;
      args: string[];
      size: { cols: number; rows: number };
      written: string[];
      resized: [number, number][];
      killed: boolean;
      print: (d: string) => void;
      end: (code: number) => void;
    }[]
);
vi.mock("node-pty", () => ({
  spawn: (
    file: string,
    args: string[],
    opts: { cols: number; rows: number }
  ) => {
    let data: (d: string) => void = () => {};
    let exit: (e: { exitCode: number }) => void = () => {};
    const p = {
      file,
      args,
      size: { cols: opts.cols, rows: opts.rows },
      written: [] as string[],
      resized: [] as [number, number][],
      killed: false,
      print: (d: string) => data(d),
      end: (code: number) => exit({ exitCode: code }),
    };
    ptys.push(p);
    return {
      onData: (fn: typeof data) => void (data = fn),
      onExit: (fn: typeof exit) => void (exit = fn),
      write: (d: string) => p.written.push(d),
      resize: (c: number, r: number) => p.resized.push([c, r]),
      pause: () => {},
      resume: () => {},
      kill: () => {
        p.killed = true;
      },
    };
  },
}));
const pending = vi.hoisted(() => new Set<string>());
vi.mock("../tasks/start", () => ({
  launchPending: (id: string) => pending.has(id),
}));
vi.mock("../agents/launch", () => ({
  agentEnv: () => ({ AGENTOS_SESSION_ID: "x" }),
}));
vi.mock("../hosts", () => ({ sshTargetFor: () => null }));

const { serveTerminal, SHELL_AFTER_MS } = await import("./connection");

function connect(query = "flow=1") {
  const ws = Object.assign(new EventEmitter(), {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
  });
  const sent: Record<string, unknown>[] = [];
  const rescan = vi.fn();
  serveTerminal(ws, new URLSearchParams(query), {
    rescan,
    send: (d) => void sent.push(JSON.parse(d)),
  });
  const say = (m: object) => ws.emit("message", Buffer.from(JSON.stringify(m)));
  return { ws, sent, say, rescan };
}

const isAttach = (p: (typeof ptys)[number]) =>
  p.args.join(" ").includes("attach-session");

beforeEach(() => {
  vi.useFakeTimers();
  ptys.length = 0;
  pending.clear();
});
afterEach(() => vi.useRealTimers());

describe("serveTerminal", () => {
  it("never starts a shell for a view that attaches at once", () => {
    const { say, ws, rescan } = connect();
    say({ type: "attach", spec: { sessionName: "s1", attachOnly: true } });
    vi.advanceTimersByTime(SHELL_AFTER_MS + 100);
    expect(ptys).toHaveLength(1);
    expect(isAttach(ptys[0])).toBe(true);
    expect(rescan).toHaveBeenCalled();
    ws.emit("close");
  });

  it("starts its own shell when no attach comes, and on early input", () => {
    const quiet = connect();
    vi.advanceTimersByTime(SHELL_AFTER_MS + 1);
    expect(ptys).toHaveLength(1);
    expect(isAttach(ptys[0])).toBe(false);
    quiet.ws.emit("close");
    expect(ptys[0].killed).toBe(true);

    const typed = connect();
    typed.say({ type: "input", data: "ls\r" });
    expect(ptys[1].written).toEqual(["ls\r"]);
    typed.ws.emit("close");
  });

  it("refuses to attach a task still setting up, starting nothing", () => {
    pending.add("task-1");
    const { say, sent, ws } = connect();
    say({ type: "attach", spec: { sessionName: "t1", sessionId: "task-1" } });
    expect(ptys).toHaveLength(0);
    expect(String(sent[0]?.data)).toContain("still setting up");
    ws.emit("close");
  });

  it("keeps a resize within bounds and ignores one that isn't numbers", () => {
    const { say, ws } = connect();
    say({ type: "attach", spec: { sessionName: "s2", attachOnly: true } });
    say({ type: "resize", cols: 0, rows: 99999 });
    expect(ptys[0].resized.at(-1)).toEqual([2, 1000]);
    say({ type: "resize", cols: "x", rows: null });
    expect(ptys[0].resized.at(-1)).toEqual([2, 1000]);
    ws.emit("close");
  });

  it("shares one attach between two views and routes acks to their own", () => {
    const a = connect();
    const b = connect();
    a.say({ type: "attach", spec: { sessionName: "s3", attachOnly: true } });
    b.say({ type: "attach", spec: { sessionName: "s3", attachOnly: true } });
    expect(ptys.filter(isAttach)).toHaveLength(1);
    a.say({ type: "input", data: "x" });
    b.say({ type: "input", data: "y" });
    expect(ptys[0].written).toEqual(["x", "y"]);
    a.ws.emit("close");
    b.ws.emit("close");
  });

  it("goes back to a shell of its own when tmux detaches", () => {
    const { say, sent, ws } = connect();
    say({ type: "attach", spec: { sessionName: "s4", attachOnly: true } });
    ptys[0].end(0);
    expect(sent.at(-1)).toEqual({ type: "detached", code: 0 });
    expect(ptys).toHaveLength(2);
    expect(isAttach(ptys[1])).toBe(false);
    ws.emit("close");
  });

  it("drops a socket that stops answering pings", () => {
    const { ws } = connect();
    const terminate = vi.fn(() => ws.emit("close"));
    Object.assign(ws, { ping: vi.fn(), terminate });
    vi.advanceTimersByTime(25_000);
    expect(terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50_000);
    expect(terminate).toHaveBeenCalled();
  });
});
