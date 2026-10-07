/**
 * Image files an agent wrote, for chat to show inline: only image types, by
 * extension (of the file itself, not a link to it), and only regular files
 * of a sane size.
 */

import { promises as fsp } from "fs";
import os from "os";
import path from "path";
import { imageType } from "./image-paths";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export async function readImage(
  p: string
): Promise<{ data: Buffer; type: string } | null> {
  if (!imageType(p)) return null;
  const file = path.resolve(p.trim().replace(/^~(?=\/)/, os.homedir()));
  try {
    const real = await fsp.realpath(file);
    const type = imageType(real);
    if (!type) return null;
    const stat = await fsp.stat(real);
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) return null;
    return { data: await fsp.readFile(real), type };
  } catch {
    return null;
  }
}
