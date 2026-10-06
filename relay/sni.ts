/**
 * Reads the server name from a TLS ClientHello without terminating TLS, so
 * the relay can route a connection it cannot read.
 */

export type SniResult =
  | { status: "more" }
  | { status: "ok"; servername: string | null }
  | { status: "invalid" };

export function parseSni(buf: Buffer): SniResult {
  // TLS record: type 22 (handshake), version, length.
  if (buf.length < 5) return { status: "more" };
  if (buf[0] !== 22) return { status: "invalid" };
  const recordLen = buf.readUInt16BE(3);
  if (buf.length < 5 + recordLen) return { status: "more" };
  let p = 5;
  if (buf[p] !== 1) return { status: "invalid" }; // ClientHello
  p += 4; // type + 24-bit length
  p += 2 + 32; // version + random
  const end = 5 + recordLen;
  const skip = (lenBytes: 1 | 2) => {
    if (p + lenBytes > end) return false;
    const n = lenBytes === 1 ? buf[p] : buf.readUInt16BE(p);
    p += lenBytes + n;
    return p <= end;
  };
  if (!skip(1) || !skip(2) || !skip(1)) return { status: "invalid" }; // session id, ciphers, compression
  if (p === end) return { status: "ok", servername: null };
  if (p + 2 > end) return { status: "invalid" };
  const extEnd = p + 2 + buf.readUInt16BE(p);
  p += 2;
  if (extEnd > end) return { status: "invalid" };
  while (p + 4 <= extEnd) {
    const type = buf.readUInt16BE(p);
    const len = buf.readUInt16BE(p + 2);
    p += 4;
    if (type === 0 && len >= 5) {
      // server_name list: list length, name type 0, name length, name.
      const nameLen = buf.readUInt16BE(p + 3);
      if (buf[p + 2] !== 0 || p + 5 + nameLen > extEnd)
        return { status: "invalid" };
      return {
        status: "ok",
        servername: buf.toString("ascii", p + 5, p + 5 + nameLen).toLowerCase(),
      };
    }
    p += len;
  }
  return { status: "ok", servername: null };
}
