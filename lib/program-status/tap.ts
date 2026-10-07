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

interface Tap {
  socket: net.Socket;
  scanner: OscScanner;
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

function accept(socket: net.Socket): void {
  let name: string | null = null;
  let header = "";
  // Reports from one pane are applied in order.
  let queue = Promise.resolve();
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
      taps.set(name, { socket, scanner: new OscScanner() });
    }
    const tap = taps.get(name);
    if (!tap || tap.socket !== socket) return void socket.destroy();
    const paneName = name;
    for (const event of tap.scanner.push(data))
      queue = queue
        .then(() => handle(paneName, event))
        .catch((err) => console.error("[osc7501]", err?.message ?? err));
  });
  socket.on("close", () => {
    if (name && taps.get(name)?.socket === socket) taps.delete(name);
  });
}

function ownedSessions(): Set<string> {
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
  const server = net.createServer(accept);
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
