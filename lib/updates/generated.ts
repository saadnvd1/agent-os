import fs from "fs";
import path from "path";

/** Files the build rewrites in a checkout; one list for the updater and the deploy scripts. */
export function generatedFiles(root: string): string[] {
  try {
    return fs
      .readFileSync(path.join(root, "scripts/generated-files.txt"), "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}

/** Splits `git status --porcelain` paths into generated files and real local changes. */
export function splitDirty(
  porcelain: string,
  generated: string[]
): { generated: string[]; blocking: string[] } {
  const out = { generated: [] as string[], blocking: [] as string[] };
  for (const line of porcelain.split("\n")) {
    const file = line.slice(3).trim();
    if (!file) continue;
    (generated.includes(file) ? out.generated : out.blocking).push(file);
  }
  return out;
}
