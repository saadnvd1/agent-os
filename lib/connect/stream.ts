/**
 * One tunnelled TCP connection, as a Duplex. Writes become DATA frames; DATA
 * frames from the other side are pushed in. When our reader falls behind we
 * tell the other side to PAUSE that stream, so one slow terminal can't stall
 * the others sharing the WebSocket.
 */

import { Duplex } from "stream";
import { encode, Frame } from "./frames";

export type Send = (frame: Buffer) => boolean;

const MAX_FRAME = 64 * 1024;

export class TunnelStream extends Duplex {
  private paused = false;
  private remotePaused = false;
  private waiting: (() => void)[] = [];
  private closedByRemote = false;
  /** Where the far end says the connection came from; informational only. */
  remoteAddress?: string;

  constructor(
    readonly id: number,
    private readonly send: Send,
    private readonly onDone: (id: number) => void,
    private readonly drained: (cb: () => void) => void
  ) {
    super({ allowHalfOpen: false });
    this.once("close", () => this.onDone(this.id));
  }

  /** DATA from the far end. */
  receive(chunk: Buffer): void {
    if (!this.push(chunk) && !this.paused) {
      this.paused = true;
      this.send(encode(Frame.PAUSE, this.id));
    }
  }

  /** The far end asked us to stop or start sending. */
  setRemotePaused(paused: boolean): void {
    this.remotePaused = paused;
    if (!paused) this.waiting.splice(0).forEach((go) => go());
  }

  /** The far end closed. */
  remoteClosed(): void {
    this.closedByRemote = true;
    this.push(null);
    this.destroy();
  }

  _read(): void {
    if (this.paused) {
      this.paused = false;
      this.send(encode(Frame.RESUME, this.id));
    }
  }

  _write(
    chunk: Buffer,
    _enc: BufferEncoding,
    done: (err?: Error) => void
  ): void {
    // Frames stay well under the relay's 1 MB message limit.
    const pieces: Buffer[] = [];
    for (let i = 0; i < chunk.length; i += MAX_FRAME) {
      pieces.push(chunk.subarray(i, i + MAX_FRAME));
    }
    const next = (): void => {
      const piece = pieces.shift();
      if (!piece) return done();
      if (this.remotePaused) return void this.waiting.push(next);
      // send() is false while the WebSocket's buffer is full; wait it out.
      if (this.send(encode(Frame.DATA, this.id, piece))) next();
      else this.drained(next);
    };
    next();
  }

  _destroy(err: Error | null, done: (err: Error | null) => void): void {
    if (!this.closedByRemote) this.send(encode(Frame.CLOSE, this.id));
    done(err);
  }

  // What http/tls expect of a socket.
  setNoDelay(): this {
    return this;
  }
  setKeepAlive(): this {
    return this;
  }
  setTimeout(): this {
    return this;
  }
}
