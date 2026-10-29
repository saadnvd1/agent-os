/**
 * The machine's one outbound connection to Connect's ActionCable, signed with
 * the machine key like every other request. Open only while a live share is
 * subscribed; nothing here accepts a connection from anywhere.
 */

import WebSocket from "ws";
import type { ConnectFiles } from "@/lib/connect/config";
import { signedHeaders } from "@/lib/connect/control-api";

export const CABLE_PATH = "/cable";
const PING_MS = 30_000;
const STALE_MS = 30_000;
const MAX_INCOMING = 256 * 1024;
export const MAX_FRAME = 60 * 1024;
const QUEUE_MAX = 500;
// Under Connect's 40/s, 300/min and 2 MB/min.
const PER_SECOND = 10;
const PER_MINUTE = 250;
const BYTES_PER_MINUTE = 1_500_000;

export interface WsLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  terminate(): void;
  on(event: "open", fn: () => void): void;
  on(event: "message", fn: (data: Buffer | string) => void): void;
  on(event: "close" | "error" | "unexpected-response", fn: () => void): void;
}

export type WsFactory = (
  url: string,
  headers: Record<string, string>
) => WsLike;

const defaultFactory: WsFactory = (url, headers) =>
  new WebSocket(url, ["actioncable-v1-json"], {
    headers,
    maxPayload: MAX_INCOMING,
    followRedirects: false,
    handshakeTimeout: 15_000,
  }) as unknown as WsLike;

export const cableUrl = (apiUrl: string) =>
  `${apiUrl.replace(/^http/, "ws")}${CABLE_PATH}`;

export interface SocketOptions {
  files: () => ConnectFiles | null;
  onFrame: (shareId: string, frame: Record<string, unknown>) => void;
  /** A share's subscription was confirmed (again, after a reconnect). */
  onConfirmed?: (shareId: string) => void;
  /** Connect refused the subscription: the share is not ours or is gone. */
  onRejected?: (shareId: string) => void;
  factory?: WsFactory;
  random?: () => number;
}

interface Queued {
  shareId: string;
  json: string;
}

const identifier = (shareId: string) =>
  JSON.stringify({ channel: "LiveHostChannel", share_id: shareId });

export class LiveSocket {
  private ws: WsLike | null = null;
  private welcomed = false;
  private shares = new Set<string>();
  private confirmed = new Set<string>();
  private queue: Queued[] = [];
  private attempts = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHeard = 0;
  private sentAt: { at: number; bytes: number }[] = [];
  dropped = 0;

  constructor(private opts: SocketOptions) {}

  get connected() {
    return this.welcomed && this.ws?.readyState === WebSocket.OPEN;
  }

  has(shareId: string) {
    return this.shares.has(shareId);
  }

  subscribe(shareId: string): void {
    this.shares.add(shareId);
    if (this.connected) this.rawSubscribe(shareId);
    else this.connect();
  }

  unsubscribe(shareId: string): void {
    this.shares.delete(shareId);
    this.confirmed.delete(shareId);
    this.queue = this.queue.filter((q) => q.shareId !== shareId);
    if (this.connected)
      this.rawSend({ command: "unsubscribe", identifier: identifier(shareId) });
    if (!this.shares.size) this.close();
  }

  /** An action on a share's channel, paced to Connect's limits. */
  send(shareId: string, action: string, data: Record<string, unknown> = {}) {
    if (!this.shares.has(shareId)) return;
    const json = JSON.stringify({
      command: "message",
      identifier: identifier(shareId),
      data: JSON.stringify({ action, ...data }),
    });
    if (Buffer.byteLength(json) > MAX_FRAME) {
      this.dropped++;
      return;
    }
    if (this.queue.length >= QUEUE_MAX) {
      this.queue.shift();
      this.dropped++;
    }
    this.queue.push({ shareId, json });
    this.drain();
  }

  close(): void {
    this.shares.clear();
    this.confirmed.clear();
    this.queue = [];
    this.teardown();
  }

  private teardown() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.drainTimer) clearTimeout(this.drainTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.pingTimer = this.drainTimer = this.retryTimer = null;
    const ws = this.ws;
    this.ws = null;
    this.welcomed = false;
    this.confirmed.clear();
    try {
      ws?.terminate();
    } catch {}
  }

  private connect() {
    if (this.ws || this.retryTimer || !this.shares.size) return;
    const files = this.opts.files();
    if (!files) return;
    let ws: WsLike;
    try {
      ws = (this.opts.factory ?? defaultFactory)(
        cableUrl(files.config.apiUrl),
        signedHeaders({
          machineId: files.config.machineId,
          privateKey: files.machineKey,
          method: "GET",
          path: CABLE_PATH,
          body: "",
        })
      );
    } catch {
      this.retry();
      return;
    }
    this.ws = ws;
    this.lastHeard = Date.now();
    ws.on("message", (raw) => this.onMessage(ws, raw));
    ws.on("close", () => this.lost(ws));
    ws.on("error", () => this.lost(ws));
    ws.on("unexpected-response", () => this.lost(ws));
  }

  private lost(ws: WsLike) {
    if (this.ws !== ws) return;
    this.teardown();
    this.retry();
  }

  private retry() {
    if (!this.shares.size || this.retryTimer) return;
    const rand = this.opts.random ?? Math.random;
    const base = Math.min(30_000, 1000 * 2 ** Math.min(this.attempts, 5));
    this.attempts++;
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = null;
        this.connect();
      },
      base * (0.5 + rand() / 2)
    );
  }

  private rawSend(msg: unknown) {
    try {
      this.ws?.send(JSON.stringify(msg));
    } catch {}
  }

  private rawSubscribe(shareId: string) {
    this.rawSend({ command: "subscribe", identifier: identifier(shareId) });
  }

  private onMessage(ws: WsLike, raw: Buffer | string) {
    if (this.ws !== ws) return;
    this.lastHeard = Date.now();
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
    } catch {
      return;
    }
    if (!m || typeof m !== "object") return;
    switch (m.type) {
      case "welcome":
        this.welcomed = true;
        this.attempts = 0;
        for (const id of this.shares) this.rawSubscribe(id);
        this.pingTimer = setInterval(() => {
          if (Date.now() - this.lastHeard > STALE_MS) return this.lost(ws);
          for (const id of this.confirmed) this.send(id, "ping");
        }, PING_MS);
        return;
      case "ping":
        return;
      case "disconnect":
        return this.lost(ws);
      case "confirm_subscription":
      case "reject_subscription": {
        const id = shareOf(m.identifier);
        if (!id || !this.shares.has(id)) return;
        if (m.type === "confirm_subscription") {
          this.confirmed.add(id);
          this.opts.onConfirmed?.(id);
          this.drain();
        } else {
          this.unsubscribe(id);
          this.opts.onRejected?.(id);
        }
        return;
      }
    }
    const id = shareOf(m.identifier);
    const frame = m.message;
    if (id && this.shares.has(id) && frame && typeof frame === "object")
      this.opts.onFrame(id, frame as Record<string, unknown>);
  }

  private drain() {
    if (this.drainTimer || !this.connected) return;
    const now = Date.now();
    this.sentAt = this.sentAt.filter((s) => now - s.at < 60_000);
    while (this.queue.length) {
      const next = this.queue.find((q) => this.confirmed.has(q.shareId));
      if (!next) return;
      const bytes = Buffer.byteLength(next.json);
      const lastSecond = this.sentAt.filter((s) => now - s.at < 1000).length;
      const minuteBytes = this.sentAt.reduce((a, s) => a + s.bytes, 0);
      if (
        lastSecond >= PER_SECOND ||
        this.sentAt.length >= PER_MINUTE ||
        minuteBytes + bytes > BYTES_PER_MINUTE
      ) {
        this.drainTimer = setTimeout(() => {
          this.drainTimer = null;
          this.drain();
        }, 250);
        return;
      }
      this.queue.splice(this.queue.indexOf(next), 1);
      this.sentAt.push({ at: now, bytes });
      try {
        this.ws?.send(next.json);
      } catch {}
    }
  }
}

function shareOf(identifier: unknown): string | null {
  if (typeof identifier !== "string") return null;
  try {
    const i = JSON.parse(identifier) as Record<string, unknown>;
    return i.channel === "LiveHostChannel" && typeof i.share_id === "string"
      ? i.share_id
      : null;
  } catch {
    return null;
  }
}
