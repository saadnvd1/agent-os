/**
 * Both ends of the tunnel: a map of TunnelStreams over one WebSocket. The
 * relay opens streams (a phone connected); the machine receives them.
 */

import type WebSocket from "ws";
import { decode, encode, Frame, json, type Decoded } from "./frames";
import { TunnelStream } from "./stream";

// Past this much unsent data, writers wait for the socket to drain.
const HIGH_WATER = 1 << 20;

export interface OpenMeta {
  remote?: string;
}

export class Mux {
  readonly streams = new Map<number, TunnelStream>();
  bytesIn = 0;
  bytesOut = 0;
  private next = 1;

  constructor(
    private readonly ws: WebSocket,
    private readonly onOpen?: (stream: TunnelStream, meta: OpenMeta) => void
  ) {}

  private send = (frame: Buffer): boolean => {
    if (this.ws.readyState !== this.ws.OPEN) return true;
    if (frame[0] === Frame.DATA) this.bytesOut += frame.length - 5;
    this.ws.send(frame);
    return this.ws.bufferedAmount < HIGH_WATER;
  };

  private drained = (cb: () => void): void => {
    const check = () => {
      if (
        this.ws.readyState !== this.ws.OPEN ||
        this.ws.bufferedAmount < HIGH_WATER
      )
        cb();
      else setTimeout(check, 20);
    };
    setTimeout(check, 20);
  };

  private stream(id: number): TunnelStream {
    const s = new TunnelStream(
      id,
      this.send,
      (done) => this.streams.delete(done),
      this.drained
    );
    this.streams.set(id, s);
    return s;
  }

  /** Relay side: a new client connection, or null if the tunnel is going away. */
  open(meta: OpenMeta): TunnelStream | null {
    if (this.ws.readyState !== this.ws.OPEN) return null;
    const id = this.next++;
    const s = this.stream(id);
    s.remoteAddress = meta.remote;
    this.ws.send(encode(Frame.OPEN, id, meta));
    return s;
  }

  /** Feed one WebSocket message in. Returns frames this layer doesn't own. */
  handle(data: Buffer): Decoded | null {
    const f = decode(data);
    if (!f) return null;
    const s = this.streams.get(f.stream);
    switch (f.type) {
      case Frame.OPEN: {
        if (!this.onOpen || this.streams.has(f.stream)) return null;
        const meta = json<OpenMeta>(f.payload) ?? {};
        const created = this.stream(f.stream);
        created.remoteAddress = meta.remote;
        this.onOpen(created, meta);
        return null;
      }
      case Frame.DATA:
        this.bytesIn += f.payload.length;
        s?.receive(Buffer.from(f.payload));
        return null;
      case Frame.CLOSE:
        s?.remoteClosed();
        return null;
      case Frame.PAUSE:
        s?.setRemotePaused(true);
        return null;
      case Frame.RESUME:
        s?.setRemotePaused(false);
        return null;
      default:
        return f;
    }
  }

  closeAll(): void {
    for (const s of this.streams.values()) s.remoteClosed();
    this.streams.clear();
  }
}
