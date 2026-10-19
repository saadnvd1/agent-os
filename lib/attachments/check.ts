import { isText, sniff } from "../intake/sniff";
import {
  ATTACHMENT_LIMITS,
  tooBigMessage,
  typeFor,
  unsupportedMessage,
  type AttachmentType,
} from "./policy";

export type UploadCheck =
  | { ok: true; type: AttachmentType }
  | { ok: false; status: 400 | 413 | 415; error: string };

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0];
const OOXML_ZIP = new Set(["xlsx", "docx", "pptx", "ods", "odt"]);
const OLE_EXTS = new Set(["xls", "doc"]);

const starts = (b: Buffer, sig: number[]) => sig.every((v, i) => b[i] === v);

const bad = (name: string): UploadCheck => ({
  ok: false,
  status: 400,
  error: `${name} doesn't look like a real .${name.split(".").pop()?.toLowerCase()} file.`,
});

/** Whether a file's name, size and bytes are something a chat accepts. */
export function checkUpload(name: string, data: Buffer): UploadCheck {
  const type = typeFor(name);
  if (!type) return { ok: false, status: 415, error: unsupportedMessage(name) };
  const limit =
    type.kind === "image"
      ? ATTACHMENT_LIMITS.maxImageBytes
      : ATTACHMENT_LIMITS.maxBytes;
  if (data.length > limit)
    return {
      ok: false,
      status: 413,
      error: tooBigMessage(name, data.length, limit),
    };
  if (!data.length)
    return { ok: false, status: 400, error: `${name} is empty.` };
  let real: boolean;
  if (type.kind === "image" || type.kind === "pdf")
    real = sniff(data, name)?.mediaType === type.mediaType;
  else if (OOXML_ZIP.has(type.ext)) real = starts(data, ZIP);
  else if (OLE_EXTS.has(type.ext)) real = starts(data, OLE);
  else real = isText(data);
  return real ? { ok: true, type } : bad(name);
}
