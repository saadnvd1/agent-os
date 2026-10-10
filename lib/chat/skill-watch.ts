/**
 * Watches the folders an agent reads its skills and slash commands from, so
 * a skill added or edited shows in the "/" menu without waiting out the
 * capabilities cache.
 *
 * One watcher per folder, shared by every key (agent + folder) that reads
 * it, and closed once no key does. A folder that doesn't exist yet is
 * watched through its nearest parent until it appears. Skills linked in as
 * symlinks are watched at their real path too, since a change inside one
 * doesn't reach the folder holding the link. A watcher that can't start is
 * skipped: the cache's TTL still applies.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { SKILL_DIRS } from "../agents/skill-dirs";

const GLOBAL_DIRS = [".claude/skills", ".claude/commands"];

// The folders the commands for an agent in `cwd` come from.
export function skillFolders(cwd: string, home = os.homedir()): string[] {
  const dirs = [
    ...GLOBAL_DIRS.map((d) => path.join(home, d)),
    ...SKILL_DIRS.map((d) => path.join(cwd, d)),
  ];
  return [...new Set(dirs.map((d) => path.resolve(d)))];
}

export interface SkillWatcher {
  // Watches `folders` for `key` (again is fine), calling onChange(key) after
  // a burst of changes settles.
  watch(key: string, folders: string[]): void;
  release(key: string): void;
  keys(): string[];
  close(): void;
}

interface Folder {
  path: string;
  keys: Set<string>;
  // By what they watch, so re-arming keeps the ones still wanted: a new
  // watcher takes a moment to start, and would miss what happens meanwhile.
  handles: Map<string, fs.FSWatcher>;
  timer?: NodeJS.Timeout;
}

const isDir = (p: string) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

// A watcher, or none when it can't start (gone, too many open, no support).
function tryWatch(
  p: string,
  recursive: boolean,
  fire: (name: string | null) => void
): fs.FSWatcher | null {
  try {
    // Persistent: macOS drops a recursive watch's events otherwise.
    const w = fs.watch(p, { recursive }, (_e, name) =>
      fire(name == null ? null : String(name))
    );
    w.on("error", () => w.close());
    return w;
  } catch {
    return null;
  }
}

export function createSkillWatcher(
  onChange: (key: string) => void,
  debounceMs = 300
): SkillWatcher {
  const folders = new Map<string, Folder>();
  const byKey = new Map<string, Set<string>>();

  const changed = (f: Folder) => {
    clearTimeout(f.timer);
    f.timer = setTimeout(() => {
      f.timer = undefined;
      if (!folders.has(f.path)) return;
      // Links and folders may have come or gone: watch what's there now.
      arm(f);
      [...f.keys].forEach((k) => onChange(k));
    }, debounceMs);
    f.timer.unref?.();
  };

  function arm(f: Folder): void {
    const want = new Map<string, () => fs.FSWatcher | null>();
    if (isDir(f.path)) {
      want.set(`r:${f.path}`, () => tryWatch(f.path, true, () => changed(f)));
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(f.path, { withFileTypes: true });
      } catch {}
      for (const e of entries) {
        if (!e.isSymbolicLink()) continue;
        let real: string;
        try {
          real = fs.realpathSync(path.join(f.path, e.name));
        } catch {
          continue;
        }
        // A skill keeps its SKILL.md at the top: no need to go deeper.
        if (isDir(real))
          want.set(`l:${real}`, () => tryWatch(real, false, () => changed(f)));
      }
    } else {
      // Not there yet: watch the nearest parent that is (at most two up, the
      // project or home folder for .claude/skills), for just the next name
      // on the way down, so busy folders like ~ don't wake it.
      let child = f.path;
      for (let up = 0; up < 2; up++) {
        const parent = path.dirname(child);
        if (parent === child) break;
        if (isDir(parent)) {
          const next = path.basename(child);
          want.set(`p:${parent}:${next}`, () =>
            tryWatch(parent, false, (name) => {
              if (name === null || name === next) changed(f);
            })
          );
          break;
        }
        child = parent;
      }
    }
    for (const [id, h] of f.handles)
      if (!want.has(id)) {
        h.close();
        f.handles.delete(id);
      }
    for (const [id, open] of want) {
      if (f.handles.has(id)) continue;
      const h = open();
      if (h) f.handles.set(id, h);
    }
  }

  return {
    watch(key, paths) {
      let mine = byKey.get(key);
      if (!mine) byKey.set(key, (mine = new Set()));
      for (const p of paths) {
        if (mine.has(p)) continue;
        mine.add(p);
        let f = folders.get(p);
        if (!f) {
          folders.set(
            p,
            (f = { path: p, keys: new Set(), handles: new Map() })
          );
          arm(f);
        }
        f.keys.add(key);
      }
    },
    release(key) {
      for (const p of byKey.get(key) ?? []) {
        const f = folders.get(p);
        if (!f) continue;
        f.keys.delete(key);
        if (f.keys.size) continue;
        clearTimeout(f.timer);
        f.handles.forEach((h) => h.close());
        folders.delete(p);
      }
      byKey.delete(key);
    },
    keys: () => [...byKey.keys()],
    close() {
      [...byKey.keys()].forEach((k) => this.release(k));
    },
  };
}
