import { spawn, type ChildProcess } from "child_process";
import { LineSplitter, parseControlLine } from "./control-parse";
import { PaneScreen } from "./screen";

/**
 * One long-lived `tmux -C` client per local session this AgentOS runs, in
 * place of polling each one with `capture-pane` and tapping it with
 * `pipe-pane`. tmux tells a control client about the panes of its own
 * session only (a client for every session would need their windows linked
 * into one, which keeps a killed session's window alive), so it's one per
 * session: one process each where a tap took three, and no spawns after.
 *
 * Each client pushes its active pane's output, which feeds:
 *   - OSC 7501 parsing (lib/program-status/tap.ts createProgramFeed)
 *   - a screen kept from that output (lib/tmux/screen.ts), so reading a
 *     session's screen costs nothing; trued up from a capture asked over the
 *     same channel when output settles, at most every RESYNC_MS
 *   - an activity flag the status hub reads each tick.
 * Clients are read-only and don't affect window size. One that exits (the
 * session or the tmux server went away) is started again by the next sync if
 * its session is still there, with backoff; AgentOS restarting takes its
 * clients with it and the new process attaches its own.
 */

const QUIET_MS = 2_000;
const RESYNC_MS = 30_000;
// A screen is kept only while its pane prints: one quiet this long is let
// go, and the status detector reads it the old way (rarely, since a pane
// that doesn't print keeps its last capture).
const IDLE_MS = 10 * 60_000;
const MAX_BACKOFF_MS = 60_000;
const COMMAND_TIMEOUT_MS = 10_000;

export interface ControlDeps {
  spawn: (args: string[]) => ChildProcess;
  feed: (name: string) => { push: (latin1: string) => void; close: () => void };
  // A session was created or destroyed somewhere on the tmux server.
  sessionsChanged: () => void;
  // A client attached for the first time in this process, or let go.
  attached: (name: string) => void;
  detached: (name: string) => void;
  now: () => number;
  // How long a command may wait for its reply, and how long output must
  // stop before the screen is trued up (tests shorten both).
  commandTimeoutMs?: number;
  quietMs?: number;
}

interface Command {
  line: string;
  resolve: (lines: string[]) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  // Called the moment its reply ends, before anything after it is read.
  onEnd?: () => void;
}

interface Watched {
  name: string;
  child: ChildProcess | null;
  screen: PaneScreen | null;
  // The screen matches the pane (seeded and not since out of step).
  synced: boolean;
  pane: string | null;
  // When it was watched from (pane known) and when its pane last printed.
  watchedFrom: number;
  printedAt: number;
  feed: ReturnType<ControlDeps["feed"]>;
  commands: Command[];
  // The reply being read, inside a %begin block of ours: its lines, and the
  // block's id, which only its own %end repeats.
  reply: { id: string; lines: string[] } | null;
  // A capture is on its way. Until its reply ends, output is already in it;
  // after, until the screen has taken the capture, it's held to apply next.
  capturing: boolean;
  held: string[] | null;
  dirty: boolean;
  syncedAt: number;
  quiet: ReturnType<typeof setTimeout> | null;
  idle: ReturnType<typeof setTimeout> | null;
  failures: number;
  retryAt: number;
  everAttached: boolean;
}

export class ControlManager {
  private watched = new Map<string, Watched>();
  private active = false;
  private stopped = false;

  constructor(private readonly deps: ControlDeps) {}

  /** The sessions to watch now: starts the new, stops the gone. */
  sync(names: Iterable<string>): void {
    if (this.stopped) return;
    const wanted = new Set(names);
    for (const [name, w] of this.watched) if (!wanted.has(name)) this.forget(w);
    const now = this.deps.now();
    for (const name of wanted) {
      const w = this.watched.get(name);
      if (!w) this.start(this.create(name));
      else if (!w.child && now >= w.retryAt) this.start(w);
    }
  }

  /**
   * The session's screen as capture-pane -e -p prints it, when kept and
   * current: not while a capture is being taken in.
   */
  screen(name: string): string | null {
    const w = this.watched.get(name);
    return w?.child && w.synced && !w.capturing && w.screen
      ? w.screen.text()
      : null;
  }

  title(name: string): string | null {
    const w = this.watched.get(name);
    return w?.child && w.screen ? w.screen.windowTitle() : null;
  }

  /**
   * Whether the session's pane printed since `at`: false is a promise that
   * a screen read then still holds. Null when that can't be said (not
   * watched, or not since then).
   */
  printedSince(name: string, at: number): boolean | null {
    const w = this.watched.get(name);
    if (!w?.child || !w.pane || w.watchedFrom > at) return null;
    return w.printedAt >= at;
  }

  watching(name: string): boolean {
    return !!this.watched.get(name)?.child;
  }

  /** Whether any watched pane printed since the last call. */
  takeActivity(): boolean {
    const was = this.active;
    this.active = false;
    return was;
  }

  size(): number {
    return [...this.watched.values()].filter((w) => w.child).length;
  }

  stopAll(): void {
    this.stopped = true;
    for (const w of this.watched.values()) this.forget(w);
  }

  private create(name: string): Watched {
    const w: Watched = {
      name,
      child: null,
      screen: null,
      synced: false,
      pane: null,
      watchedFrom: 0,
      printedAt: 0,
      feed: this.deps.feed(name),
      commands: [],
      reply: null,
      capturing: false,
      held: null,
      dirty: false,
      syncedAt: 0,
      quiet: null,
      idle: null,
      failures: 0,
      retryAt: 0,
      everAttached: false,
    };
    this.watched.set(name, w);
    return w;
  }

  private start(w: Watched): void {
    const child = this.deps.spawn([
      "-C",
      "attach-session",
      "-f",
      "read-only,ignore-size",
      "-t",
      `=${w.name}`,
    ]);
    w.child = child;
    w.reply = null;
    const lines = new LineSplitter();
    child.stdout?.on("data", (chunk: Buffer) => {
      if (w.child !== child) return;
      for (const line of lines.push(chunk)) this.line(w, line);
    });
    child.stdin?.on("error", () => {});
    child.on("error", () => this.exited(w, child));
    child.on("exit", () => this.exited(w, child));
    if (!w.everAttached) {
      w.everAttached = true;
      this.deps.attached(w.name);
    }
    void this.identify(w);
  }

  // Which pane is the session's active one: only its output counts.
  private async identify(w: Watched): Promise<void> {
    try {
      const [pane] = await this.command(
        w,
        `display-message -p -t =${w.name}: '#{pane_id}'`
      );
      const id = pane?.trim();
      if (id?.startsWith("%") && id !== w.pane) {
        // Another pane: nothing read from the last one says anything now.
        w.watchedFrom = this.deps.now();
        w.pane = id;
        this.dropScreen(w);
      }
    } catch {
      // Exited or not answering: the next start asks again.
    }
  }

  /**
   * A tmux command over the session's control client, without starting a
   * process: its output lines, or null when the session isn't watched.
   */
  async query(name: string, line: string): Promise<string[] | null> {
    const w = this.watched.get(name);
    if (!w?.child) return null;
    try {
      return await this.command(w, line);
    } catch {
      return null;
    }
  }

  private exited(w: Watched, child: ChildProcess): void {
    if (w.child !== child) return;
    w.child = null;
    w.synced = false;
    w.capturing = false;
    w.held = null;
    w.pane = null;
    for (const c of w.commands.splice(0)) {
      clearTimeout(c.timer);
      c.reject(new Error("control client exited"));
    }
    w.failures++;
    w.retryAt =
      this.deps.now() +
      Math.min(1000 * 2 ** Math.min(w.failures, 6), MAX_BACKOFF_MS);
  }

  private forget(w: Watched): void {
    this.watched.delete(w.name);
    const child = w.child;
    w.child = null;
    if (w.quiet) clearTimeout(w.quiet);
    if (w.idle) clearTimeout(w.idle);
    for (const c of w.commands.splice(0)) {
      clearTimeout(c.timer);
      c.reject(new Error("stopped"));
    }
    child?.kill();
    w.feed.close();
    w.screen?.dispose();
    w.screen = null;
    if (w.everAttached) this.deps.detached(w.name);
  }

  private dropScreen(w: Watched): void {
    w.screen?.dispose();
    w.screen = null;
    w.synced = false;
  }

  private line(w: Watched, line: string): void {
    // Inside a reply to one of our commands: collect until its own end.
    if (w.reply) {
      const parsed = line.startsWith("%") ? parseControlLine(line) : null;
      if (parsed?.type === "end" && parsed.id === w.reply.id) {
        const lines = w.reply.lines;
        w.reply = null;
        const c = w.commands.shift();
        if (c) {
          clearTimeout(c.timer);
          c.onEnd?.();
          if (parsed.error) c.reject(new Error(lines.join("\n")));
          else c.resolve(lines);
        }
      } else w.reply.lines.push(line);
      return;
    }
    const parsed = parseControlLine(line);
    switch (parsed.type) {
      case "begin":
        // A command this client sent; the attach's own block isn't one.
        if (parsed.ours && w.commands.length)
          w.reply = { id: parsed.id, lines: [] };
        return;
      case "output":
        if (parsed.pane !== w.pane) return;
        this.active = true;
        w.printedAt = this.deps.now();
        w.feed.push(parsed.data);
        this.idleLater(w);
        if (w.held) return void w.held.push(parsed.data);
        if (w.capturing) return;
        // The first output since the screen was let go: start one.
        if (!w.screen) return void this.resync(w);
        w.screen.write(parsed.data);
        this.settleLater(w);
        return;
      case "layout-change":
        void this.identify(w);
        if (!w.screen) return;
        w.dirty = true;
        w.syncedAt = 0;
        this.settleLater(w);
        return;
      case "pane-changed":
        // The next output from whichever pane is active starts its screen.
        void this.identify(w);
        return;
      case "sessions-changed":
        this.deps.sessionsChanged();
        return;
      default:
        return;
    }
  }

  // Once output stops for a moment, true the screen up from a capture (not
  // more often than RESYNC_MS).
  private settleLater(w: Watched): void {
    w.dirty = true;
    if (w.quiet) clearTimeout(w.quiet);
    const quiet = this.deps.quietMs ?? QUIET_MS;
    const due = Math.max(quiet, w.syncedAt + RESYNC_MS - this.deps.now());
    w.quiet = setTimeout(() => {
      w.quiet = null;
      if (w.dirty) void this.resync(w);
    }, due);
    w.quiet.unref?.();
  }

  private idleLater(w: Watched): void {
    if (w.idle) clearTimeout(w.idle);
    w.idle = setTimeout(() => {
      w.idle = null;
      w.screen?.dispose();
      w.screen = null;
      w.synced = false;
    }, IDLE_MS);
    w.idle.unref?.();
  }

  private command(
    w: Watched,
    line: string,
    onEnd?: () => void
  ): Promise<string[]> {
    const child = w.child;
    if (!child?.stdin?.writable) return Promise.reject(new Error("no client"));
    return new Promise((resolve, reject) => {
      // A reply that's late would answer the next command in line: start
      // the client over instead (its exit fails what's still waiting, and
      // the next sync attaches again).
      const timer = setTimeout(
        () => child.kill(),
        this.deps.commandTimeoutMs ?? COMMAND_TIMEOUT_MS
      );
      timer.unref?.();
      w.commands.push({ line, resolve, reject, timer, onEnd });
      child.stdin!.write(`${line}\n`);
    });
  }

  private async resync(w: Watched): Promise<void> {
    if (!w.child || w.capturing) return;
    const target = `=${w.name}:`;
    w.capturing = true;
    w.dirty = false;
    try {
      const [info] = await this.command(
        w,
        `display-message -p -t ${target} '#{pane_id} #{pane_width} #{pane_height} #{cursor_x} #{cursor_y}'`
      );
      // Output before the capture's reply ends is in it; output after is
      // held from that moment and applied on top.
      const capture = await this.command(
        w,
        `capture-pane -e -p -t ${target}`,
        () => (w.held = [])
      );
      const [pane, cols, rows, x, y] = (info ?? "").trim().split(" ");
      const size = { cols: Number(cols), rows: Number(rows) };
      if (!pane || !(size.cols > 0) || !(size.rows > 0)) throw new Error(info);
      if (pane !== w.pane) {
        w.pane = pane;
        w.watchedFrom = this.deps.now();
      }
      w.screen ??= new PaneScreen(size.cols, size.rows);
      await w.screen.reset(capture.join("\n"), size.cols, size.rows, {
        x: Number(x) || 0,
        y: Number(y) || 0,
      });
      for (const data of w.held ?? []) w.screen.write(data);
      w.synced = true;
      w.syncedAt = this.deps.now();
      w.failures = 0;
      // Held output moved the screen on: it's checked again later, not now.
      if (w.held?.length) this.settleLater(w);
    } catch {
      w.synced = false;
    } finally {
      w.held = null;
      w.capturing = false;
    }
  }
}

export function spawnTmux(args: string[]): ChildProcess {
  return spawn("tmux", args, { stdio: ["pipe", "pipe", "ignore"] });
}

// One per process, shared by the server and the Next.js route bundles.
const g = globalThis as unknown as { __agentosTmuxControl?: ControlManager };
export const controlManager = (): ControlManager | undefined =>
  g.__agentosTmuxControl;
export function setControlManager(m: ControlManager | undefined): void {
  g.__agentosTmuxControl = m;
}
