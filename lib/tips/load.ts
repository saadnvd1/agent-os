import fs from "fs";
import path from "path";
import { fileSchema, type Tip } from "./schema";

export const TIPS_FILE = "content/tips.json";

let cached: { file: string; mtime: number; tips: Tip[] } | null = null;

/** Every tip that isn't retired. A missing or unreadable file is empty. */
export function loadTips(root: string = process.cwd()): Tip[] {
  const file = path.join(root, TIPS_FILE);
  try {
    const mtime = fs.statSync(file).mtimeMs;
    if (cached?.file === file && cached.mtime === mtime) return cached.tips;
    const parsed = fileSchema.safeParse(
      JSON.parse(fs.readFileSync(file, "utf-8"))
    );
    const tips = parsed.success
      ? parsed.data.tips.filter((t) => !t.hidden)
      : [];
    cached = { file, mtime, tips };
    return tips;
  } catch {
    return [];
  }
}
