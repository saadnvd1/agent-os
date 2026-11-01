import fs from "fs";
import path from "path";
import { dataRoot } from "../db/path";
import { ATTACHMENT_LIMITS, typeFor } from "./policy";
import type { ChatFile } from "./types";

// Outside every repo and worktree, so an agent's `git add -A` never picks a
// file up; a folder per session, `new` for a draft that has no session yet.
export const attachmentsRoot = () => path.join(dataRoot(), "attachments");

const segment = (s: string) => s.replace(/[^\w-]/g, "_");

/** A client's filename as one safe path segment, unique among `taken`. */
export function safeName(name: string, taken: Set<string>, n: number): string {
  let base = path.basename(name.replace(/\\/g, "/"));
  base = base
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 80);
  if (!base) base = `file-${n}`;
  let out = base;
  for (let i = 2; taken.has(out); i++) {
    const dot = base.lastIndexOf(".");
    out =
      dot > 0 ? `${base.slice(0, dot)}-${i}${base.slice(dot)}` : `${base}-${i}`;
  }
  taken.add(out);
  return out;
}

// A short description kept beside a big file (a HAR's hosts and failures),
// which the agent is given with the path.
export const summaryPath = (file: string) => `${file}.summary.txt`;

export function scopeDir(scope: string): string {
  return path.join(attachmentsRoot(), segment(scope) || "new");
}

export function saveAttachment(
  scope: string,
  name: string,
  data: Buffer,
  mediaType: string,
  summary?: string
): ChatFile {
  const dir = scopeDir(scope);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const taken = new Set(fs.readdirSync(dir));
  const file = safeName(name, taken, taken.size + 1);
  const full = path.join(dir, file);
  fs.writeFileSync(full, data, { mode: 0o600 });
  if (summary) fs.writeFileSync(summaryPath(full), summary, { mode: 0o600 });
  return { path: full, name: file, size: data.length, mediaType };
}

function inside(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * The files a client says it attached, kept only where they really are a
 * file inside the attachments folder (symlinks followed): a client can name
 * any path, and the agent is told to open what's named here. Size and type
 * come from the disk, not the client.
 */
export function resolveFiles(raw: unknown): ChatFile[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  let root: string;
  try {
    root = fs.realpathSync(attachmentsRoot());
  } catch {
    return undefined;
  }
  const out: ChatFile[] = [];
  for (const f of raw.slice(0, ATTACHMENT_LIMITS.max)) {
    const p = (f as { path?: unknown } | null)?.path;
    if (typeof p !== "string") continue;
    try {
      const real = fs.realpathSync(p);
      const stat = fs.statSync(real);
      if (!inside(root, real) || !stat.isFile()) continue;
      out.push({
        path: real,
        name: path.basename(real),
        size: stat.size,
        mediaType: typeFor(real)?.mediaType ?? "application/octet-stream",
      });
    } catch {
      // Gone or unreadable: dropped.
    }
  }
  return out.length ? out : undefined;
}

export function removeSessionAttachments(sessionId: string): Promise<void> {
  return fs.promises.rm(scopeDir(sessionId), { recursive: true, force: true });
}
