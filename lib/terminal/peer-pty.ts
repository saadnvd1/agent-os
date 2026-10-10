import type { EventEmitter } from "events";
import type { IncomingMessage } from "http";
import type { AttachSpec } from "../hosts/attach";
import { openPeerSocket } from "../hosts/peer-socket";
import { cleanRemoteText, type HostLink } from "../hosts/remote-api";
import type { Pty } from "./shared-attach";

/**
 * A session's terminal on a linked machine, through that machine's own
 * AgentOS: its /ws/terminal attaches there, and this stands in for the pty
 * a local attach would spawn. The other machine runs tmux; this one only
 * relays bytes, so ssh is never involved.
 *
 * Flow control carries through: the other side is asked for `?flow=1` and
 * each output is acked as it arrives, except while the shared attach here
 * has paused us, so a slow viewer here slows tmux there.
 *
 * A dropped connection is retried with backoff; the other side's shared
 * attach replays the screen (from a reset) on rejoin. A refused token or a
 * session that detached ends it.
 */

export interface PeerSocket extends EventEmitter {
  readyState: number;
  send(data: string): void;
  close(): void;
  terminate?(): void;
}

export const PEER_RETRY_MS = [1000, 2000, 4000, 8000, 15_000];
// Retries stop once the link has been down this long.
export const PEER_GIVE_UP_MS = 2 * 60_000;

const OPEN = 1;

export class PeerPty implements Pty {
  private data: (d: string) => void = () => {};
  private exit: (e: { exitCode: number }) => void = () => {};
  private ws: PeerSocket | null = null;
  private done = false;
  private paused = false;
  private owed = 0;
  private attempt = 0;
  private opened = false;
  private downSince: number | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly link: HostLink,
    private readonly spec: AttachSpec,
    private cols: number,
    private rows: number,
    private readonly open: (link: HostLink) => PeerSocket = (l) =>
      openPeerSocket(l, "/ws/terminal", { flow: "1" }),
    private readonly now: () => number = Date.now
  ) {
    // After whoever made this has subscribed to its data and exit.
    queueMicrotask(() => this.connect());
  }

  onData(fn: (d: string) => void) {
    this.data = fn;
  }

  onExit(fn: (e: { exitCode: number }) => void) {
    this.exit = fn;
  }

  write(data: string): void {
    this.sendJson({ type: "input", data });
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.sendJson({ type: "resize", cols, rows });
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    for (; this.owed > 0; this.owed--) this.sendJson({ type: "ack" });
  }

  kill(): void {
    if (this.done) return;
    this.done = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.ws?.close();
    this.ws = null;
  }

  private sendJson(msg: object): void {
    const ws = this.ws;
    if (ws?.readyState === OPEN) ws.send(JSON.stringify(msg));
  }

  private say(text: string): void {
    this.data(`\r\n\x1b[2m${text}\x1b[0m\r\n`);
  }

  private finish(code: number, why?: string): void {
    if (this.done) return;
    if (why) this.data(`\r\n\x1b[31m${why}\x1b[0m\r\n`);
    this.kill();
    this.exit({ exitCode: code });
  }

  private connect(): void {
    if (this.done) return;
    let ws: PeerSocket;
    try {
      ws = this.open(this.link);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!this.opened)
        return this.finish(
          1,
          `Can't reach AgentOS on ${this.link.hostName}: ${cleanRemoteText(message)}.`
        );
      return this.lost(message);
    }
    this.ws = ws;
    this.owed = 0;
    let refused = false;
    ws.on("unexpected-response", (_req: unknown, res: IncomingMessage) => {
      refused = true;
      const status = res.statusCode ?? 0;
      res.resume?.();
      ws.terminate?.();
      this.finish(
        1,
        status === 401 || status === 403
          ? `${this.link.hostName} refused this machine's link (${status}). Link it again in Machines.`
          : `${this.link.hostName}'s AgentOS answered ${status}; can't open its terminal.`
      );
    });
    ws.on("open", () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.downSince = null;
      this.opened = true;
      this.sendJson({ type: "resize", cols: this.cols, rows: this.rows });
      const { sessionName, attachOnly, cwd, command, sessionId } = this.spec;
      this.sendJson({
        type: "attach",
        spec: { sessionName, attachOnly, cwd, command, sessionId },
      });
    });
    ws.on("message", (raw: Buffer | string) => {
      if (this.ws !== ws) return;
      let msg: { type?: unknown; data?: unknown; code?: unknown };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === "output" && typeof msg.data === "string") {
        this.data(msg.data);
        if (this.paused) this.owed++;
        else this.sendJson({ type: "ack" });
      } else if (msg.type === "detached" || msg.type === "exit") {
        this.finish(typeof msg.code === "number" ? msg.code : 0);
      }
    });
    let error = "";
    ws.on("error", (err: Error) => {
      // "close" follows and decides.
      error = err?.message ?? "";
    });
    ws.on("close", () => {
      if (this.ws !== ws || refused) return;
      this.ws = null;
      // Never reached at all: say so now rather than retry in silence.
      if (!this.opened)
        return this.finish(
          1,
          `Can't reach AgentOS on ${this.link.hostName}${error ? `: ${cleanRemoteText(error)}` : ""}.`
        );
      this.lost(error);
    });
  }

  private lost(reason?: string): void {
    if (this.done) return;
    const now = this.now();
    this.downSince ??= now;
    if (now - this.downSince >= PEER_GIVE_UP_MS) {
      return this.finish(
        1,
        `Lost ${this.link.hostName}'s AgentOS${reason ? `: ${cleanRemoteText(reason)}` : ""}.`
      );
    }
    const wait =
      PEER_RETRY_MS[Math.min(this.attempt, PEER_RETRY_MS.length - 1)];
    this.attempt++;
    this.say(`Reconnecting to ${this.link.hostName}...`);
    this.retry = setTimeout(() => {
      this.retry = null;
      this.connect();
    }, wait);
    this.retry.unref?.();
  }
}
