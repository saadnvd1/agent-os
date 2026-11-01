import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { redactHar } from "./har";
import {
  extOf,
  isHeic,
  type AttachmentKind,
  type AttachmentType,
} from "./policy";

const run = promisify(execFile);

export type Prepared =
  | {
      ok: true;
      data: Buffer;
      name: string;
      mediaType: string;
      kind: AttachmentKind;
      // Saved beside the file and given to the agent with its path.
      summary?: string;
    }
  | { ok: false; status: 400; error: string };

export type Converter = (cmd: string, args: string[]) => Promise<unknown>;

const realConverter: Converter = (cmd, args) =>
  run(cmd, args, { timeout: 30_000 });

// sips ships with macOS; ImageMagick and libheif cover Linux.
const TOOLS = (src: string, out: string): [string, string[]][] => [
  ["sips", ["-s", "format", "jpeg", src, "--out", out]],
  ["magick", [src, out]],
  ["heif-convert", [src, out]],
];

/** A JPEG of an iPhone photo, or null when this machine has no converter. */
export async function heicToJpeg(
  data: Buffer,
  convert: Converter = realConverter
): Promise<Buffer | null> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-heic-"));
  try {
    const src = path.join(dir, "in.heic");
    const out = path.join(dir, "out.jpg");
    fs.writeFileSync(src, data);
    for (const [cmd, args] of TOOLS(src, out)) {
      try {
        await convert(cmd, args);
        if (fs.existsSync(out)) return fs.readFileSync(out);
      } catch {
        // Not installed or failed: the next tool.
      }
    }
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** What is stored for a checked upload: secrets removed, photos converted. */
export async function prepareUpload(
  type: AttachmentType,
  name: string,
  data: Buffer,
  convert?: Converter
): Promise<Prepared> {
  const keep: Prepared = {
    ok: true,
    data,
    name,
    mediaType: type.mediaType,
    kind: type.kind,
  };
  if (type.ext === "har") {
    const har = redactHar(data.toString("utf8"));
    if (!har)
      return {
        ok: false,
        status: 400,
        error: `${name} doesn't look like a real HAR file.`,
      };
    return { ...keep, data: Buffer.from(har.json), summary: har.summary };
  }
  if (isHeic(name)) {
    const jpeg = await heicToJpeg(data, convert);
    if (!jpeg) return keep;
    const stem = name.slice(0, name.length - extOf(name).length - 1);
    return {
      ...keep,
      data: jpeg,
      name: `${stem}.jpg`,
      mediaType: "image/jpeg",
    };
  }
  return keep;
}
