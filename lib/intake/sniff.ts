export interface Sniffed {
  kind: "image" | "pdf" | "text" | "video";
  mediaType: string;
}

const BLOCKED_NAME =
  /\.(sh|command|app|exe|dmg|pkg|zip|gz|tgz|rar|7z|jar|bat|ps1)$/i;

const starts = (b: Buffer, sig: number[], at = 0) =>
  sig.every((v, i) => b[at + i] === v);

function isText(b: Buffer): boolean {
  const head = b.subarray(0, 8192);
  if (head.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(head);
    return true;
  } catch {
    // A multi-byte character cut by the 8 KB slice is still text.
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(head.subarray(0, -3));
      return true;
    } catch {
      return false;
    }
  }
}

/** What a file is by its bytes, or null when it isn't a kind we take. */
export function sniff(buf: Buffer, name: string): Sniffed | null {
  if (BLOCKED_NAME.test(name)) return null;
  if (starts(buf, [0xff, 0xd8, 0xff]))
    return { kind: "image", mediaType: "image/jpeg" };
  if (starts(buf, [0x89, 0x50, 0x4e, 0x47]))
    return { kind: "image", mediaType: "image/png" };
  if (starts(buf, [0x47, 0x49, 0x46, 0x38]))
    return { kind: "image", mediaType: "image/gif" };
  if (
    starts(buf, [0x52, 0x49, 0x46, 0x46]) &&
    starts(buf, [0x57, 0x45, 0x42, 0x50], 8)
  )
    return { kind: "image", mediaType: "image/webp" };
  if (starts(buf, [0x25, 0x50, 0x44, 0x46]))
    return { kind: "pdf", mediaType: "application/pdf" };
  if (starts(buf, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = buf.subarray(8, 12).toString("latin1");
    if (/^hei[cxm]|^mif1|^msf1/.test(brand))
      return { kind: "image", mediaType: "image/heic" };
    if (/^(qt  |mp4|isom|M4V|avc1)/.test(brand))
      return {
        kind: "video",
        mediaType: brand === "qt  " ? "video/quicktime" : "video/mp4",
      };
    return null;
  }
  if (starts(buf, [0x23, 0x21])) return null;
  if (isText(buf)) return { kind: "text", mediaType: "text/plain" };
  return null;
}
