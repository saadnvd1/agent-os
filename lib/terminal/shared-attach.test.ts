import { describe, expect, it, vi } from "vitest";
import {
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

  it("tells every viewer when tmux goes away, and stops when the last leaves", () => {
    const pty = fakePty();
    const gone = vi.fn();
    const attach = new SharedAttach(pty, 20, 4, gone);
    const a = viewer();
    attach.join(a.v);
    pty.end(1);
    expect(a.detached).toEqual([1]);
    expect(gone).toHaveBeenCalledWith(1);

    const pty2 = fakePty();
    const second = new SharedAttach(pty2, 20, 4, () => {});
    const b = viewer();
    second.join(b.v);
    second.leave(b.v);
    expect(pty2.kill).toHaveBeenCalled();
    expect(second.alive).toBe(false);
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
});
