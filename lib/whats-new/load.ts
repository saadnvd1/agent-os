import fs from "fs";
import path from "path";
import { fileSchema, type Entry, type Head, type Page } from "./schema";

export const WHATS_NEW_FILE = "content/whats-new.json";

const fileAt = (root: string) => path.join(root, WHATS_NEW_FILE);

let cached: { file: string; mtime: number; entries: Entry[] } | null = null;

// Newest first: by day, then by PR number within it. The file is append-only
// and in the order the generator wrote it, so the order is made here.
export const byNewest = (a: Entry, b: Entry) =>
  a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1;

/** Every shown entry, newest first. A missing or unreadable file is empty. */
export function loadEntries(root: string = process.cwd()): Entry[] {
  const file = fileAt(root);
  try {
    const mtime = fs.statSync(file).mtimeMs;
    if (cached?.file === file && cached.mtime === mtime) return cached.entries;
    const parsed = fileSchema.safeParse(
      JSON.parse(fs.readFileSync(file, "utf-8"))
    );
    const entries = parsed.success
      ? parsed.data.entries.filter((e) => !e.hidden).sort(byNewest)
      : [];
    cached = { file, mtime, entries };
    return entries;
  } catch {
    return [];
  }
}

const RECENT = 10;

export function headOf(entries: Entry[]): Head {
  return {
    latestId: entries.reduce((m, e) => Math.max(m, e.id), 0),
    latestDate: entries[0]?.date ?? null,
    count: entries.length,
    recent: entries.slice(0, RECENT).map((e) => e.id),
  };
}

/** `limit` entries older than the `before` day (all days when it is unset). */
export function pageOf(
  entries: Entry[],
  { before, limit }: { before?: string | null; limit: number }
): Page {
  const older = before ? entries.filter((e) => e.date < before) : entries;
  const slice = older.slice(0, limit);
  // Never split a day across pages: the next page starts at a day boundary.
  const last = slice[slice.length - 1];
  const rest = older.slice(limit);
  while (last && rest.length && rest[0].date === last.date)
    slice.push(rest.shift()!);
  return { entries: slice, hasMore: rest.length > 0 };
}
