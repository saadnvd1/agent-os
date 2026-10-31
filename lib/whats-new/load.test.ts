import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@/lib/test-temp";
import { lintEntry } from "./lint";
import { headOf, loadEntries, pageOf, WHATS_NEW_FILE } from "./load";
import { fileSchema, type Entry } from "./schema";

const e = (id: number, date: string, extra: Partial<Entry> = {}): Entry => ({
  id,
  date,
  kind: "new",
  area: "Chat",
  text: `Thing ${id}.`,
  ...extra,
});

function rootWith(entries: Entry[]) {
  const root = tempDir("aos-whatsnew-load-");
  fs.mkdirSync(path.join(root, "content"));
  fs.writeFileSync(
    path.join(root, WHATS_NEW_FILE),
    JSON.stringify({ v: 1, entries })
  );
  return root;
}

describe("loadEntries", () => {
  it("hides hidden entries and sorts newest first", () => {
    const root = rootWith([
      e(1, "2026-10-01"),
      e(3, "2026-10-02"),
      e(2, "2026-10-02", { hidden: true }),
      e(4, "2026-10-02"),
    ]);
    expect(loadEntries(root).map((x) => x.id)).toEqual([4, 3, 1]);
    expect(headOf(loadEntries(root))).toEqual({
      latestId: 4,
      latestDate: "2026-10-02",
      count: 3,
      recent: [4, 3, 1],
    });
  });

  it("is empty for a missing or broken file", () => {
    expect(loadEntries(tempDir("aos-whatsnew-none-"))).toEqual([]);
    const root = tempDir("aos-whatsnew-bad-");
    fs.mkdirSync(path.join(root, "content"));
    fs.writeFileSync(path.join(root, WHATS_NEW_FILE), "{nope");
    expect(loadEntries(root)).toEqual([]);
  });
});

describe("pageOf", () => {
  const all = [
    e(5, "2026-10-03"),
    e(4, "2026-10-02"),
    e(3, "2026-10-02"),
    e(2, "2026-10-01"),
  ];
  it("never splits a day across pages", () => {
    const first = pageOf(all, { limit: 2 });
    expect(first.entries.map((x) => x.id)).toEqual([5, 4, 3]);
    expect(first.hasMore).toBe(true);
    const next = pageOf(all, { before: "2026-10-02", limit: 2 });
    expect(next.entries.map((x) => x.id)).toEqual([2]);
    expect(next.hasMore).toBe(false);
  });
});

describe("the shipped file", () => {
  it("is valid, unique by id and passes the generic public-repo checks", () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), WHATS_NEW_FILE), "utf-8")
    );
    const { entries } = fileSchema.parse(raw);
    expect(new Set(entries.map((x) => x.id)).size).toBe(entries.length);
    for (const entry of entries)
      expect([entry.id, lintEntry(entry)]).toEqual([entry.id, null]);
  });
});
