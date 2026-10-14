/**
 * Copies of a session's uncommitted artifacts, made just before its
 * worktree is removed: a plan or mockup under .agentos/ is ignored by git,
 * so nothing else holds it once the worktree goes. Committed files need no
 * copy; the manifest records them so the view can say "in the PR".
 */

import fs from "fs";
import os from "os";
import path from "path";
import { git } from "../git-exec";
import { isSecretPath } from "../secret-paths";

export const MAX_KEPT_FILE = 2 * 1024 * 1024;
export const MAX_KEPT_TOTAL = 20 * 1024 * 1024;

export interface Manifest {
  worktree: string;
  at: string;
  // Paths relative to the worktree.
  tracked: string[];
  kept: string[];
}

export function keptDir(): string {
  return (
    process.env.AGENTOS_KEPT_DIR || path.join(os.homedir(), ".agent-os", "kept")
  );
}

const safeId = (sessionId: string) => sessionId.replace(/[^\w-]/g, "_");

export const sessionKeptDir = (sessionId: string) =>
  path.join(keptDir(), safeId(sessionId));

export function readManifest(sessionId: string): Manifest | null {
  try {
    const m = JSON.parse(
      fs.readFileSync(
        path.join(sessionKeptDir(sessionId), "manifest.json"),
        "utf8"
      )
    ) as Manifest;
    return Array.isArray(m.tracked) && Array.isArray(m.kept) ? m : null;
  } catch {
    return null;
  }
}

// A worktree-relative path that stays inside it, else null.
export function relInside(worktree: string, file: string): string | null {
  const rel = path.relative(worktree, file);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel;
}

/**
 * Keep what `files` (absolute paths in the worktree) holds that git doesn't.
 * Never throws: a failure here must not stop the worktree's removal.
 */
export async function keepFiles(
  sessionId: string,
  worktree: string,
  files: string[]
): Promise<Manifest | null> {
  try {
    const rels = [
      ...new Set(
        files
          .map((f) => relInside(worktree, f))
          .filter((r): r is string => !!r && !isSecretPath(r))
      ),
    ];
    if (!rels.length) return null;
    const out = await git(worktree, ["ls-files", "-z", "--", ...rels], {
      timeout: 10_000,
      literalPathspecs: true,
    }).catch(() => "");
    const tracked = new Set(out.split("\0").filter(Boolean));
    const dir = sessionKeptDir(sessionId);
    const kept: string[] = [];
    let total = 0;
    for (const rel of rels) {
      if (tracked.has(rel)) continue;
      const src = path.join(worktree, rel);
      try {
        const stat = await fs.promises.lstat(src);
        if (!stat.isFile() || stat.size > MAX_KEPT_FILE) continue;
        if (total + stat.size > MAX_KEPT_TOTAL) continue;
        const dest = path.join(dir, rel);
        await fs.promises.mkdir(path.dirname(dest), {
          recursive: true,
          mode: 0o700,
        });
        await fs.promises.copyFile(src, dest);
        total += stat.size;
        kept.push(rel);
      } catch {
        // One file failing keeps the rest.
      }
    }
    const manifest: Manifest = {
      worktree,
      at: new Date().toISOString(),
      tracked: [...tracked],
      kept,
    };
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.promises.writeFile(
      path.join(dir, "manifest.json"),
      JSON.stringify(manifest),
      { mode: 0o600 }
    );
    return manifest;
  } catch (error) {
    console.error(`[session-artifacts] keeping ${sessionId}:`, error);
    return null;
  }
}
