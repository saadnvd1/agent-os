/**
 * Image files an agent wrote, for chat to show inline: only image types, by
 * extension, and only regular files of a sane size.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { imageType } from "./image-paths";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export function readImage(p: string): { data: Buffer; type: string } | null {
  const type = imageType(p);
  if (!type) return null;
  const file = path.resolve(p.trim().replace(/^~(?=\/)/, os.homedir()));
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) return null;
    return { data: fs.readFileSync(file), type };
  } catch {
    return null;
  }
}
