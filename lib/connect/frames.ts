/**
 * The Connect tunnel's wire format: one WebSocket from a machine to the
 * relay, carrying many TCP streams. Each binary message is one frame:
 *
 *   type (u8) | stream id (u32 BE) | payload
 *
 * The relay only ever moves the TLS bytes of user connections; it never
 * holds a key that could read them.
 */

export const Frame = {
  /** machine → relay: {machineId, ts, nonce, sig} */
  HELLO: 0,
  /** relay → machine: a phone connected; payload {remote} */
  OPEN: 1,
  DATA: 2,
  /** either side: this stream is done */
  CLOSE: 3,
  /** relay → machine: {hostname} once HELLO checks out */
  READY: 4,
  /** either side: stop / start sending DATA for this stream */
  PAUSE: 5,
  RESUME: 6,
  /** relay → machine: refused, payload {error}; the socket closes after */
  DENIED: 7,
} as const;

export type FrameType = (typeof Frame)[keyof typeof Frame];

export interface Decoded {
  type: FrameType;
  stream: number;
  payload: Buffer;
}

export function encode(
  type: FrameType,
  stream = 0,
  payload?: Buffer | string | object
): Buffer {
  const body =
    payload === undefined
      ? Buffer.alloc(0)
      : Buffer.isBuffer(payload)
        ? payload
        : Buffer.from(
            typeof payload === "string" ? payload : JSON.stringify(payload)
          );
  const head = Buffer.alloc(5);
  head.writeUInt8(type, 0);
  head.writeUInt32BE(stream, 1);
  return Buffer.concat([head, body]);
}

export function decode(data: Buffer): Decoded | null {
  if (data.length < 5) return null;
  const type = data.readUInt8(0);
  if (type > Frame.DENIED) return null;
  return {
    type: type as FrameType,
    stream: data.readUInt32BE(1),
    payload: data.subarray(5),
  };
}

export const json = <T>(payload: Buffer): T | null => {
  try {
    return JSON.parse(payload.toString("utf8")) as T;
  } catch {
    return null;
  }
};
