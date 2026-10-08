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
// After its last viewer goes, the attach (and the screen kept for replay)
// stays this long, so a reconnecting phone picks up where it was.
export const GRACE_MS = 30_000;

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
  // Replays sent and not yet acked: they don't count toward the window.
  replays: number;
  behind: boolean;
}

export function newViewer(
  send: (message: string) => void,
  detached: (code: number) => void,
  flow: boolean,
  cols: number,
  rows: number
): Viewer {
  return {
    send,
    detached,
    flow,
    cols,
    rows,
    pending: [],
    replays: 0,
    behind: false,
  };
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
  private grace: ReturnType<typeof setTimeout> | null = null;
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
      if (this.grace) clearTimeout(this.grace);
      this.grace = null;
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
    if (this.grace) clearTimeout(this.grace);
    this.grace = null;
    this.viewers.add(viewer);
    this.fit();
    if (this.printed) this.replay(viewer);
    this.repause();
  }

  leave(viewer: Viewer): void {
    this.viewers.delete(viewer);
    if (this.viewers.size) this.fit();
    else if (!this.grace && !this.closing && !this.exited) {
      this.grace = setTimeout(() => {
        this.grace = null;
        if (this.viewers.size) return;
        this.closing = true;
        this.pty.kill();
      }, GRACE_MS);
      this.grace.unref?.();
    }
    this.repause();
  }

  /** Ends it now, whoever is watching (the server is going away). */
  close(): void {
    if (this.grace) clearTimeout(this.grace);
    this.grace = null;
    this.closing = true;
    this.pty.kill();
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
    if (viewer.replays > 0) viewer.replays--;
    else viewer.pending.shift();
    if (viewer.behind && viewer.pending.length === 0 && viewer.replays === 0) {
      viewer.behind = false;
      this.replay(viewer);
      this.fit();
    }
    this.repause();
  }

  // The smallest size among viewers keeping up: one that stopped acking (a
  // phone asleep with its socket half open) doesn't hold the rest small.
  private fit(): void {
    if (!this.viewers.size || this.exited) return;
    const keeping = [...this.viewers].filter((v) => !v.behind);
    const sizes = keeping.length ? keeping : [...this.viewers];
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
        if (!v.behind) {
          v.behind = true;
          this.fit();
        }
        continue;
      }
      v.pending.push(message.length);
      v.send(message);
    }
    this.repause();
  }

  // tmux is held back only while every viewer acks and none has room: a
  // viewer that doesn't ack, or none at all (the grace after the last one
  // left), keeps it flowing.
  private repause(): void {
    if (this.exited) return;
    const viewers = [...this.viewers];
    const hold =
      viewers.length > 0 &&
      viewers.every((v) => v.flow && (v.behind || full(v)));
    if (hold && !this.paused) {
      this.paused = true;
      this.pty.pause();
    } else if (!hold && this.paused) {
      this.paused = false;
      this.pty.resume();
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
      // A replay is acked like any message but isn't held against the
      // window: it can be bigger than the window by itself.
      if (viewer.flow) viewer.replays++;
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
