import { describe, expect, it, vi } from "vitest";
import {
  GRACE_MS,
  MAX_PENDING_CHUNKS,
  SharedAttach,
  SharedAttaches,
  newViewer,
  type Pty,
} from "./shared-attach";

function fakePty() {
  let data: (d: string) => void = () => {};
  let exit: (e: { exitCode: number }) => void = () => {};
  const pty = {
    onData: (fn: (d: string) => void) => void (data = fn),
    onExit: (fn: (e: { exitCode: number }) => void) => void (exit = fn),
    write: vi.fn(),
    resize: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    kill: vi.fn(),
    print: (d: string) => data(d),
    end: (code = 0) => exit({ exitCode: code }),
  };
  return pty as Pty & typeof pty;
}

function viewer(flow = true, cols = 80, rows = 24) {
  const got: string[] = [];
  const detached: number[] = [];
  const v = newViewer(
    (m) => got.push(JSON.parse(m).data),
    (code) => detached.push(code),
    flow,
    cols,
    rows
  );
  return { v, got, detached };
}

const flush = () => new Promise((r) => setTimeout(r, 5));

describe("SharedAttach", () => {
  it("sends one stream to every viewer and takes input from any", async () => {
    const pty = fakePty();
    const attach = new SharedAttach(pty, 80, 24, () => {});
    const a = viewer();
    const b = viewer();
    attach.join(a.v);
    attach.join(b.v);
    pty.print("hel");
    pty.print("lo");
    await flush();
    expect(a.got).toEqual(["hello"]);
    expect(b.got).toEqual(["hello"]);
    attach.input("x");
    expect(pty.write).toHaveBeenCalledWith("x");
  });

  it("runs at the smallest viewer's size", () => {
    const pty = fakePty();
    const attach = new SharedAttach(pty, 120, 40, () => {});
    attach.join(viewer(true, 120, 40).v);
    const phone = viewer(true, 50, 30);
    attach.join(phone.v);
    expect(pty.resize).toHaveBeenLastCalledWith(50, 30);
    attach.leave(phone.v);
    expect(pty.resize).toHaveBeenLastCalledWith(120, 40);
  });

  it("stops sending to a viewer that doesn't ack, then gives it the screen", async () => {
    const pty = fakePty();
    const attach = new SharedAttach(pty, 20, 4, () => {});
    const slow = viewer();
    attach.join(slow.v);
    for (let i = 0; i < MAX_PENDING_CHUNKS + 3; i++) {
      pty.print(`line${i}\r\n`);
      await flush();
    }
    expect(slow.got).toHaveLength(MAX_PENDING_CHUNKS);
    // It was the only viewer: tmux is held back meanwhile.
    expect(pty.pause).toHaveBeenCalled();
    for (let i = 0; i < MAX_PENDING_CHUNKS; i++) attach.ack(slow.v);
    expect(pty.resume).toHaveBeenCalled();
    await flush();
    const resync = slow.got.at(-1)!;
    expect(resync.startsWith("\x1bc")).toBe(true);
    expect(resync).toContain(`line${MAX_PENDING_CHUNKS + 2}`);
  });

  it("never holds back a viewer that doesn't ack (an older page)", async () => {
    const pty = fakePty();
    const attach = new SharedAttach(pty, 20, 4, () => {});
    const old = viewer(false);
    attach.join(old.v);
    for (let i = 0; i < MAX_PENDING_CHUNKS + 3; i++) {
      pty.print(`l${i}`);
      await flush();
    }
    expect(old.got).toHaveLength(MAX_PENDING_CHUNKS + 3);
    expect(pty.pause).not.toHaveBeenCalled();
  });

  it("shows a late joiner the current screen first", async () => {
    const pty = fakePty();
    const attach = new SharedAttach(pty, 20, 4, () => {});
    attach.join(viewer().v);
    pty.print("prompt> ");
    await flush();
    const late = viewer();
    attach.join(late.v);
    await flush();
    expect(late.got[0]).toBe("\x1bcprompt> ");
  });

  it("tells every viewer when tmux goes away", () => {
    const pty = fakePty();
    const gone = vi.fn();
    const attach = new SharedAttach(pty, 20, 4, gone);
    const a = viewer();
    attach.join(a.v);
    pty.end(1);
    expect(a.detached).toEqual([1]);
    expect(gone).toHaveBeenCalledWith(1);
  });

  it("keeps running a while after the last viewer leaves, for a reconnect", async () => {
    vi.useFakeTimers();
    try {
      const pty = fakePty();
      const attach = new SharedAttach(pty, 20, 4, () => {});
      const first = viewer();
      attach.join(first.v);
      pty.print("history line\r\n");
      await vi.advanceTimersByTimeAsync(5);
      attach.leave(first.v);
      expect(pty.kill).not.toHaveBeenCalled();
      expect(attach.alive).toBe(true);
      // Back within the grace: the kept screen is replayed.
      const back = viewer();
      attach.join(back.v);
      await vi.advanceTimersByTimeAsync(5);
      expect(back.got[0]).toContain("history line");
      attach.leave(back.v);
      await vi.advanceTimersByTimeAsync(GRACE_MS + 1);
      expect(pty.kill).toHaveBeenCalled();
      expect(attach.alive).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a viewer back within the grace keeps the attach for as long as it stays", async () => {
    vi.useFakeTimers();
    try {
      const pty = fakePty();
      const attach = new SharedAttach(pty, 20, 4, () => {});
      const first = viewer();
      attach.join(first.v);
      attach.leave(first.v);
      const back = viewer();
      attach.join(back.v);
      // Long past the first leave's grace, still watched: still running.
      await vi.advanceTimersByTimeAsync(GRACE_MS * 3);
      expect(pty.kill).not.toHaveBeenCalled();
      expect(attach.alive).toBe(true);
      attach.leave(back.v);
      await vi.advanceTimersByTimeAsync(GRACE_MS + 1);
      expect(pty.kill).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("doesn't count a replay bigger than the window against it", async () => {
    const pty = fakePty();
    const attach = new SharedAttach(pty, 80, 24, () => {});
    attach.join(viewer(false).v);
    // Enough history that the replay alone is over the window.
    for (let i = 0; i < 400; i++) pty.print(`${"x".repeat(200)} ${i}\r\n`);
    await flush();
    const late = viewer();
    attach.join(late.v);
    // The replay is serialized off the headless terminal, which a slow
    // machine can take longer than one flush to finish.
    await vi.waitFor(() => expect(late.got.length).toBeGreaterThan(0));
    expect(late.got[0].length).toBeGreaterThan(64 * 1024);
    pty.print("live");
    await flush();
    expect(late.got.at(-1)).toBe("live");
    expect(late.v.behind).toBe(false);
    // Acking the replay leaves the live chunk counted.
    attach.ack(late.v);
    expect(late.v.pending).toHaveLength(1);
  });

  it("isn't held back by an acking viewer while one that doesn't ack watches", async () => {
    const pty = fakePty();
    const attach = new SharedAttach(pty, 20, 4, () => {});
    const slow = viewer(true);
    const old = viewer(false);
    attach.join(slow.v);
    attach.join(old.v);
    for (let i = 0; i < MAX_PENDING_CHUNKS + 3; i++) {
      pty.print(`l${i}`);
      await flush();
    }
    expect(slow.v.behind).toBe(true);
    expect(pty.pause).not.toHaveBeenCalled();
    // The one that doesn't ack leaves: now everyone is behind.
    attach.leave(old.v);
    expect(pty.pause).toHaveBeenCalled();
    // Another such viewer joins: it gets output again.
    attach.join(viewer(false).v);
    expect(pty.resume).toHaveBeenCalled();
  });

  it("lets tmux go again as soon as the viewer has room", async () => {
    const pty = fakePty();
    const attach = new SharedAttach(pty, 20, 4, () => {});
    const slow = viewer();
    attach.join(slow.v);
    for (let i = 0; i < MAX_PENDING_CHUNKS; i++) {
      pty.print(`x${i}`);
      await flush();
    }
    expect(pty.pause).toHaveBeenCalledTimes(1);
    attach.ack(slow.v);
    expect(pty.resume).toHaveBeenCalledTimes(1);
  });

  it("sizes to viewers keeping up, not one that stopped acking", async () => {
    const pty = fakePty();
    const attach = new SharedAttach(pty, 120, 40, () => {});
    const desk = viewer(false, 120, 40);
    const phone = viewer(true, 50, 30);
    attach.join(desk.v);
    attach.join(phone.v);
    expect(pty.resize).toHaveBeenLastCalledWith(50, 30);
    for (let i = 0; i < MAX_PENDING_CHUNKS + 1; i++) {
      pty.print(`p${i}`);
      await flush();
    }
    expect(phone.v.behind).toBe(true);
    expect(pty.resize).toHaveBeenLastCalledWith(120, 40);
  });
});

describe("SharedAttaches", () => {
  it("shares one attach per key until it's gone", () => {
    const registry = new SharedAttaches();
    const ptys: ReturnType<typeof fakePty>[] = [];
    const make = (onGone: () => void) => {
      const pty = fakePty();
      ptys.push(pty);
      return new SharedAttach(pty, 80, 24, onGone);
    };
    const first = registry.open("local:s", make);
    expect(registry.open("local:s", make)).toBe(first);
    expect(registry.open("local:t", make)).not.toBe(first);
    ptys[0].end();
    expect(registry.open("local:s", make)).not.toBe(first);
    expect(registry.count()).toBe(2);
  });

  it("starts anew past one being killed, and the old one's end leaves it be", () => {
    const registry = new SharedAttaches();
    const ptys: ReturnType<typeof fakePty>[] = [];
    const make = (onGone: () => void) => {
      const pty = fakePty();
      ptys.push(pty);
      return new SharedAttach(pty, 80, 24, onGone);
    };
    const dying = registry.open("local:s", make);
    dying.close();
    const next = registry.open("local:s", make);
    expect(next).not.toBe(dying);
    // The killed one exits afterwards: the new one stays registered.
    ptys[0].end();
    expect(registry.open("local:s", make)).toBe(next);
  });
});
