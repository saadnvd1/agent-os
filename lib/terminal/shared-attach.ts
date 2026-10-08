import { Terminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";

/**
 * One `tmux attach` per session, shared by every browser showing it,
 * instead of one per view. It runs at the smallest size among its viewers
 * (tmux's own "smallest" policy), so a bigger view shows the whole screen
 * with room to spare rather than a narrower one getting lines it can't fit.
 *
 * A viewer that acks (`?flow=1`) gets output only while fewer than
 * MAX_PENDING_CHUNKS / MAX_PENDING_BYTES are unacked. One that falls behind
 * stops getting output and, once it has caught up, is sent the current
 * screen instead of the backlog. While every acking viewer is behind, the
 * pty is paused, so a slow client slows tmux rather than filling memory.
 * The screen (and some scrollback) is kept server-side, from the same
 * output, for a viewer that joins later or catches up.
 */

export const MAX_PENDING_CHUNKS = 8;
export const MAX_PENDING_BYTES = 64 * 1024;
const SCROLLBACK = 1000;

export interface Pty {
  onData(fn: (data: string) => void): { dispose(): void } | void;
  onExit(fn: (e: { exitCode: number }) => void): { dispose(): void } | void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  pause(): void;
  resume(): void;
  kill(): void;
}

export interface Viewer {
  send(message: string): void;
  // tmux detached or the session ended; the viewer goes back to a shell.
  detached(code: number): void;
  flow: boolean;
  cols: number;
  rows: number;
  pending: number[];
  behind: boolean;
}

export function newViewer(
  send: (message: string) => void,
  detached: (code: number) => void,
  flow: boolean,
  cols: number,
  rows: number
): Viewer {
  return { send, detached, flow, cols, rows, pending: [], behind: false };
}

const full = (v: Viewer) =>
  v.pending.length >= MAX_PENDING_CHUNKS ||
  v.pending.reduce((n, size) => n + size, 0) >= MAX_PENDING_BYTES;

export class SharedAttach {
  readonly viewers = new Set<Viewer>();
  private screen: Terminal;
  private serializer = new SerializeAddon();
  private paused = false;
  private exited = false;
  private closing = false;
  private queued = "";
  // Whether there's a screen to show yet.
  private printed = false;
  private flushing = false;

  constructor(
    private readonly pty: Pty,
    private cols: number,
    private rows: number,
    // Called once the attach is over (tmux detached, or the session ended).
    private readonly onGone: (code: number) => void
  ) {
    this.screen = new Terminal({
      cols,
      rows,
      scrollback: SCROLLBACK,
      allowProposedApi: true,
    });
    this.screen.loadAddon(this.serializer);
    pty.onData((data) => this.output(data));
    pty.onExit(({ exitCode }) => {
      this.exited = true;
      this.screen.dispose();
      const viewers = [...this.viewers];
      this.viewers.clear();
      for (const v of viewers) v.detached(exitCode);
      this.onGone(exitCode);
    });
  }

  /** Still running and not on its way out: a viewer may join it. */
  get alive(): boolean {
    return !this.exited && !this.closing;
  }

  get size(): { cols: number; rows: number } {
    return { cols: this.cols, rows: this.rows };
  }

  /** A new viewer sees the screen as it is, then follows. */
  join(viewer: Viewer): void {
    this.viewers.add(viewer);
    this.fit();
    if (this.printed) this.replay(viewer);
  }

  leave(viewer: Viewer): void {
    this.viewers.delete(viewer);
    if (this.viewers.size) {
      this.fit();
      this.pauseIfAllBehind();
    } else {
      this.closing = true;
      this.pty.kill();
    }
  }

  input(data: string): void {
    if (!this.exited) this.pty.write(data);
  }

  resize(viewer: Viewer, cols: number, rows: number): void {
    viewer.cols = cols;
    viewer.rows = rows;
    this.fit();
  }

  /** The viewer took a chunk: it may have room again. */
  ack(viewer: Viewer): void {
    viewer.pending.shift();
    if (viewer.behind && viewer.pending.length === 0) {
      viewer.behind = false;
      this.replay(viewer);
    }
    if (this.paused && !full(viewer)) {
      this.paused = false;
      this.pty.resume();
    }
  }

  private fit(): void {
    if (!this.viewers.size || this.exited) return;
    const sizes = [...this.viewers];
    const cols = Math.max(2, Math.min(...sizes.map((v) => v.cols)));
    const rows = Math.max(1, Math.min(...sizes.map((v) => v.rows)));
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    this.pty.resize(cols, rows);
    this.screen.resize(cols, rows);
  }

  // Output is gathered for a tick, then sent as one message per viewer.
  private output(data: string): void {
    this.printed = true;
    this.screen.write(data);
    this.queued += data;
    if (this.flushing) return;
    this.flushing = true;
    setImmediate(() => {
      this.flushing = false;
      const chunk = this.queued;
      this.queued = "";
      if (chunk) this.deliver(chunk);
    });
  }

  private deliver(data: string): void {
    const message = JSON.stringify({ type: "output", data });
    for (const v of this.viewers) {
      if (!v.flow) {
        v.send(message);
        continue;
      }
      if (v.behind || full(v)) {
        v.behind = true;
        continue;
      }
      v.pending.push(message.length);
      v.send(message);
    }
    this.pauseIfAllBehind();
  }

  private pauseIfAllBehind(): void {
    const acking = [...this.viewers].filter((v) => v.flow);
    if (
      !this.paused &&
      acking.length > 0 &&
      acking.length === this.viewers.size &&
      acking.every((v) => v.behind || full(v))
    ) {
      this.paused = true;
      this.pty.pause();
    }
  }

  // The screen as it stands, scrollback first, drawn from a reset terminal.
  private replay(viewer: Viewer): void {
    if (this.exited) return;
    this.screen.write("", () => {
      if (this.exited) return;
      const message = JSON.stringify({
        type: "output",
        data: `\x1bc${this.serializer.serialize({ scrollback: SCROLLBACK })}`,
      });
      if (viewer.flow) viewer.pending.push(message.length);
      viewer.send(message);
    });
  }
}

// One per session (and machine): who's attached to what.
export class SharedAttaches {
  private byKey = new Map<string, SharedAttach>();

  /** The running attach for `key`, or a new one from `create`. */
  open(
    key: string,
    create: (onGone: () => void) => SharedAttach
  ): SharedAttach {
    const existing = this.byKey.get(key);
    if (existing?.alive) return existing;
    const attach = create(() => {
      if (this.byKey.get(key) === attach) this.byKey.delete(key);
    });
    this.byKey.set(key, attach);
    return attach;
  }

  count(): number {
    return this.byKey.size;
  }
}
