import { describe, it, expect } from "vitest";
import { EventEmitter } from "events";
import type WebSocket from "ws";
import { Mux, MAX_STREAMS } from "./mux";
import { decode, encode, Frame } from "./frames";
import { MAX_BUFFERED } from "./stream";

// A WebSocket stand-in that records what was sent.
function fakeWs(readyState = 1) {
  const sent: Buffer[] = [];
  const ws = Object.assign(new EventEmitter(), {
    OPEN: 1,
    readyState,
    bufferedAmount: 0,
    send: (b: Buffer) => {
      if (ws.readyState !== 1) throw new Error("not open");
      sent.push(b);
    },
  });
  return { ws: ws as unknown as WebSocket & { readyState: number }, sent };
}

describe("Mux", () => {
  it("won't open a stream on a closing socket, and doesn't throw", () => {
    const { ws } = fakeWs(2);
    expect(new Mux(ws).open({ remote: "1.2.3.4" })).toBeNull();
  });

  it("splits a large write into frames of 64 KB at most", async () => {
    const { ws, sent } = fakeWs();
    const s = new Mux(ws).open({})!;
    await new Promise<void>((r) =>
      s.write(Buffer.alloc(200 * 1024, 1), () => r())
    );
    const data = sent.map(decode).filter((f) => f?.type === Frame.DATA);
    expect(data.length).toBe(4);
    expect(Math.max(...data.map((f) => f!.payload.length))).toBe(64 * 1024);
  });

  it("asks the far end to pause when nobody reads, and caps the buffer", async () => {
    const { ws, sent } = fakeWs();
    const mux = new Mux(ws);
    const s = mux.open({})!;
    const chunk = Buffer.alloc(100 * 1024); // past the 64 KB high-water mark
    mux.handle(encode(Frame.DATA, 1, chunk));
    expect(sent.some((b) => decode(b)?.type === Frame.PAUSE)).toBe(true);
    // A far end that ignores PAUSE gets the stream torn down, not unbounded memory.
    for (let i = 0; i < MAX_BUFFERED / chunk.length + 2; i++) {
      mux.handle(encode(Frame.DATA, 1, chunk));
    }
    expect(s.destroyed).toBe(true);
    await new Promise((r) => setImmediate(r)); // "close" is emitted next tick
    expect(mux.streams.has(1)).toBe(false);
  });

  it("ignores frames for streams it doesn't have, and junk", () => {
    const { ws } = fakeWs();
    const mux = new Mux(ws);
    expect(() =>
      mux.handle(encode(Frame.DATA, 99, Buffer.from("x")))
    ).not.toThrow();
    expect(mux.handle(Buffer.from([1]))).toBeNull();
  });
});

describe("Mux on the machine side", () => {
  it("refuses streams past the cap instead of accepting them", () => {
    const { ws, sent } = fakeWs();
    let opened = 0;
    const mux = new Mux(ws, () => opened++);
    for (let id = 1; id <= MAX_STREAMS + 5; id++)
      mux.handle(encode(Frame.OPEN, id, {}));
    expect(opened).toBe(MAX_STREAMS);
    expect(sent.filter((b) => decode(b)?.type === Frame.CLOSE).length).toBe(5);
  });
});
