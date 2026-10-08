/**
 * Reads OSC 7501 from local terminal sessions. tmux drops escape sequences
 * it doesn't know, so each session's pane output is copied, raw, with
 * `tmux pipe-pane -O` into a unix socket this server listens on: the pane's
 * name on the first line, then its bytes. The pipe belongs to tmux, so it
 * outlives this server; on start every pane is tapped again, and a new
 * session within a few seconds.
 *
 * Remote-host sessions are not tapped: their output never passes through
 * this machine except while attached. They keep reading the screen.
 */
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { getDb } from "../db";
import { isValidTmuxName } from "../hosts/attach";
import { shellQuote } from "../hosts/ssh";
import { notifyStatusChanged } from "../status/hub";
import { OscScanner, type OscEvent } from "./parse";
import {
  applyProgramReport,
  dropProgramTransient,
  programSessions,
} from "./store";

const execFileAsync = promisify(execFile);
const tmux = (args: string[]) =>
  execFileAsync("tmux", args, { timeout: 5000 }).then((r) => r.stdout);

const SCAN_MS = 3000;
const MAX_HEADER = 256;
// The feature-detection reply is typed into the pane: at most this often.
const REPLY_MS = 1000;
const REPORTS_PER_SECOND = 50;
const MAX_DEFERRED = 66;
const MAX_PENDING = REPORTS_PER_SECOND + MAX_DEFERRED;

interface Tap {
  socket: net.Socket;
  feed: ReturnType<typeof createProgramFeed>;
}

const taps = new Map<string, Tap>();
const replied = new Map<string, number>();

// In a directory only this user can enter: only they can write reports.
export function tapSocketPath(port: number): string {
  return path.join(os.homedir(), ".agent-os", "run", `osc-${port}.sock`);
}

async function foreground(name: string): Promise<string | undefined> {
  try {
    const out = await tmux([
      "display-message",
      "-p",
      "-t",
      `=${name}:`,
      "#{pane_current_command}",
    ]);
    return out.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function handle(name: string, event: OscEvent): Promise<void> {
  if (event.type === "query") {
    const last = replied.get(name) ?? 0;
    if (Date.now() - last < REPLY_MS) return;
    replied.set(name, Date.now());
    // The spec's one reply: the same fixed body back, nothing from the report.
    await tmux(["send-keys", "-t", `=${name}:`, "-l", "\x1b]7501;?\x1b\\"]);
    return;
  }
  const changed =
    event.type === "prompt"
      ? dropProgramTransient(name)
      : applyProgramReport(
          name,
          event.report,
          event.report.state === "working" || event.report.state === "blocked"
            ? await foreground(name)
            : undefined
        );
  if (changed) notifyStatusChanged();
}

// What one pane has said but isn't applied yet: the latest report per
// record id (and one prompt, one query), so a pane printing reports in a
// loop costs at most this many tmux calls and writes at a time.
export function eventKey(event: OscEvent): string {
  if (event.type !== "report") return event.type;
  const { state, id } = event.report;
  return `${state === "clear" ? "c" : "r"}:${id}`;
}

// A clear makes queued reports under it moot.
export function covered(key: string, clear: OscEvent): boolean {
  if (clear.type !== "report" || clear.report.state !== "clear") return false;
  const id = clear.report.id;
  if (!key.startsWith("r:")) return false;
  const reportId = key.slice(2);
  return id === "" || reportId === id || reportId.startsWith(id + "/");
}

/**
 * One pane's output, scanned for OSC 7501 and applied. Reports from one pane
 * are applied in order, coalesced while busy. Past REPORTS_PER_SECOND, the
 * rest of that second's wait (the newest per record, a bounded few) and go
 * in when the second ends: a burst can't lose the report that ends it. Fed
 * by a pipe-pane tap or a control-mode client (lib/tmux/control.ts).
 */
export function createProgramFeed(name: string): {
  push: (latin1: string) => void;
  close: () => void;
} {
  const scanner = new OscScanner();
  let pending = new Map<string, OscEvent>();
  const deferred = new Map<string, OscEvent>();
  let flush: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  const queue = (into: Map<string, OscEvent>, event: OscEvent) => {
    // A newer report for the same record replaces the queued one, at its
    // new place in line.
    const key = eventKey(event);
    for (const queued of [...into.keys()])
      if (covered(queued, event)) into.delete(queued);
    into.delete(key);
    into.set(key, event);
    // Bounded whatever the drain's pace: the oldest goes.
    const max = into === deferred ? MAX_DEFERRED : MAX_PENDING;
    if (into.size > max) into.delete(into.keys().next().value!);
  };
  let draining = false;
  let windowStart = 0;
  let inWindow = 0;
  const drain = async () => {
    draining = true;
    while (pending.size > 0 && !closed) {
      const batch = [...pending.values()];
      pending = new Map();
      for (const event of batch)
        await handle(name, event).catch((err) =>
          console.error("[osc7501]", err?.message ?? err)
        );
    }
    draining = false;
  };
  return {
    push(data) {
      if (closed) return;
      for (const event of scanner.push(data)) {
        const now = Date.now();
        if (now - windowStart >= 1000) {
          windowStart = now;
          inWindow = 0;
          // Last second's leftovers go first, ahead of anything newer, even
          // if their timer hasn't fired yet.
          if (flush) clearTimeout(flush);
          flush = null;
          for (const e of deferred.values()) queue(pending, e);
          deferred.clear();
        }
        if (++inWindow <= REPORTS_PER_SECOND) {
          queue(pending, event);
          continue;
        }
        queue(deferred, event);
        flush ??= setTimeout(
          () => {
            flush = null;
            for (const e of deferred.values()) queue(pending, e);
            deferred.clear();
            if (!draining && pending.size > 0) void drain();
          },
          Math.max(0, 1000 - (now - windowStart))
        );
      }
      if (!draining && pending.size > 0) void drain();
    },
    close() {
      closed = true;
      if (flush) clearTimeout(flush);
    },
  };
}

// Exported for tests.
export function acceptTapConnection(socket: net.Socket): void {
  let name: string | null = null;
  let header = "";
  socket.setEncoding("latin1");
  socket.on("error", () => socket.destroy());
  socket.on("data", (chunk: string) => {
    let data = chunk;
    if (name === null) {
      header += data;
      const nl = header.indexOf("\n");
      if (nl === -1) {
        if (header.length > MAX_HEADER) socket.destroy();
        return;
      }
      const claimed = header.slice(0, nl);
      data = header.slice(nl + 1);
      header = "";
      if (!isValidTmuxName(claimed)) return void socket.destroy();
      name = claimed;
      const previous = taps.get(name);
      if (previous && previous.socket !== socket) previous.socket.destroy();
      taps.set(name, { socket, feed: createProgramFeed(name) });
    }
    const tap = taps.get(name);
    if (!tap || tap.socket !== socket) return void socket.destroy();
    tap.feed.push(data);
  });
  socket.on("close", () => {
    const tap = name ? taps.get(name) : undefined;
    if (tap?.socket === socket) {
      tap.feed.close();
      taps.delete(name!);
    }
  });
}

export function ownedSessions(): Set<string> {
  const rows = getDb()
    .prepare(
      `SELECT tmux_name FROM sessions
        WHERE tmux_name IS NOT NULL AND archived_at IS NULL
          AND (view IS NULL OR view != 'chat')
          AND (host_id IS NULL OR host_id = 'local')`
    )
    .all() as { tmux_name: string }[];
  return new Set(rows.map((r) => r.tmux_name).filter(isValidTmuxName));
}

async function panePipes(): Promise<Map<string, boolean>> {
  const out = await tmux([
    "list-panes",
    "-a",
    "-F",
    "#{session_name}\t#{window_active}\t#{pane_active}\t#{pane_pipe}",
  ]).catch(() => "");
  const pipes = new Map<string, boolean>();
  for (const line of out.split("\n")) {
    const [name, windowActive, paneActive, pipe] = line.split("\t");
    if (name && windowActive === "1" && paneActive === "1")
      pipes.set(name, pipe === "1");
  }
  return pipes;
}

/**
 * Starts the socket and keeps every local terminal session tapped. Sessions
 * this AgentOS doesn't know (another instance's, or plain tmux) are left
 * alone.
 */
export function startProgramStatusTap(port: number): {
  rescan: () => void;
} {
  const socketPath = tapSocketPath(port);
  const command = (name: string) =>
    // tmux expands formats and strftime (%) in it: echo and a checked name.
    `{ echo ${name}; exec cat; } | exec nc -U ${shellQuote(socketPath).replace(/[#%]/g, "$&$&")}`;
  let first = true;
  let scanning = false;

  const scan = async () => {
    if (scanning) return;
    scanning = true;
    try {
      const pipes = await panePipes();
      const owned = ownedSessions();
      for (const [name, piped] of pipes) {
        if (!owned.has(name)) continue;
        // After a restart, the old pipes write to a socket nobody reads.
        if (piped && !(first && !taps.has(name))) continue;
        // And whatever it said while nobody read it is lost: a saved
        // working or blocked may be stale, so the screen decides until it
        // reports again. Done and error stand.
        if (first && dropProgramTransient(name)) notifyStatusChanged();
        await tmux(["pipe-pane", "-O", "-t", `=${name}:`, command(name)]).catch(
          () => {}
        );
      }
      // A session that ended took its program with it.
      for (const name of programSessions())
        if (!pipes.has(name) && dropProgramTransient(name))
          notifyStatusChanged();
      for (const [name, tap] of taps)
        if (!pipes.has(name)) tap.socket.destroy();
      first = false;
    } catch (err) {
      console.error("[osc7501] scan failed:", err);
    } finally {
      scanning = false;
    }
  };

  fs.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(socketPath), 0o700);
  fs.rmSync(socketPath, { force: true });
  const server = net.createServer(acceptTapConnection);
  server.on("error", (err) =>
    console.error("[osc7501] socket failed:", err.message)
  );
  server.listen(socketPath, async () => {
    fs.chmodSync(socketPath, 0o600);
    try {
      await execFileAsync("sh", ["-c", "command -v nc"]);
    } catch {
      console.warn("[osc7501] nc not found: terminals keep reading the screen");
      return;
    }
    void scan();
    setInterval(() => void scan(), SCAN_MS);
  });

  return {
    // A session was just attached or created: tap it without waiting.
    rescan: () => {
      setTimeout(() => void scan(), 500);
      setTimeout(() => void scan(), 1500);
    },
  };
}
