import fs from "fs";
import os from "os";
import path from "path";

const TAIL_BYTES = 6000;
const found = new Map<string, string>();

// Claude Code writes each background task's output under
// <tmp>/claude-<uid>/<project>/<session>/tasks/<task id>.output; the path is
// only reported when the task ends, so a running one is found by name.
function findOutputFile(taskId: string): string | null {
  const cached = found.get(taskId);
  if (cached && fs.existsSync(cached)) return cached;
  const uid = process.getuid?.() ?? "";
  const roots = [...new Set([os.tmpdir(), "/tmp", "/private/tmp"])].map((d) =>
    path.join(d, `claude-${uid}`)
  );
  const name = `${taskId}.output`;
  for (const root of roots) {
    const hit = walk(root, name, 4);
    if (hit) {
      found.set(taskId, hit);
      return hit;
    }
  }
  return null;
}

function walk(dir: string, name: string, depth: number): string | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries)
    if (e.isFile() && e.name === name) return path.join(dir, e.name);
  if (depth === 0) return null;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const hit = walk(path.join(dir, e.name), name, depth - 1);
    if (hit) return hit;
  }
  return null;
}

// The last few KB of what a background task has printed so far.
export function taskOutputTail(
  taskId: string,
  knownFile?: string
): string | null {
  const file =
    knownFile && fs.existsSync(knownFile) ? knownFile : findOutputFile(taskId);
  if (!file) return null;
  try {
    const { size } = fs.statSync(file);
    const fd = fs.openSync(file, "r");
    try {
      const start = Math.max(0, size - TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const text = buf.toString("utf8");
      return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}
