import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { buildMatchQuery } from "./buildMatchQuery";

function index(rows: string[]) {
  const db = new Database(":memory:");
  db.exec(
    `CREATE VIRTUAL TABLE t USING fts5(body, tokenize = "unicode61 remove_diacritics 2 tokenchars '_'", prefix = '2 3')`
  );
  rows.forEach((r, i) =>
    db.prepare(`INSERT INTO t (rowid, body) VALUES (?, ?)`).run(i + 1, r)
  );
  return (q: string) => {
    const m = buildMatchQuery(q);
    if (!m) return null;
    return (
      db.prepare(`SELECT rowid FROM t WHERE t MATCH ?`).all(m.match) as {
        rowid: number;
      }[]
    ).map((r) => r.rowid);
  };
}

describe("buildMatchQuery", () => {
  const search = index([
    "the compaction ran twice",
    "merge gate failed, then the gate merge passed",
    "use snake_case names",
    "Café résumé",
    "NEAR AND OR NOT are words here",
    "path/to/file.ts: line 3 (a-b) c++",
  ]);

  it("matches a prefix while the word is still being typed", () => {
    expect(search("compac")).toEqual([1]);
    expect(search("comp")).toEqual([1]);
  });

  it("matches every word, in any order", () => {
    expect(search("gate merge")).toEqual([2]);
  });

  it("matches a quoted phrase exactly, in order", () => {
    expect(search('"merge gate"')).toEqual([2]);
    expect(search('"gate failed"')).toEqual([2]);
    expect(search('"gate gate"')).toEqual([]);
  });

  it("treats an open quote as a phrase being typed", () => {
    expect(search('"merge ga')).toEqual([2]);
  });

  it("keeps snake_case one word and ignores accents", () => {
    expect(search("snake_c")).toEqual([3]);
    expect(search("cafe")).toEqual([4]);
  });

  it.each([
    "NEAR",
    "AND",
    "a AND",
    "OR NOT",
    "col:term",
    "body:compaction",
    "(",
    ")",
    "a (b",
    "foo*",
    "^start",
    "-minus",
    "+plus",
    'say "hi',
    '"',
    'a"b',
    "c++",
    "path/to/file.ts:",
    "'; DROP TABLE t; --",
  ])("never breaks the FTS syntax: %s", (q) => {
    expect(() => search(q)).not.toThrow();
  });

  it("finds operator words as plain words", () => {
    expect(search("near and")).toEqual([5]);
  });

  it("is null for nothing searchable", () => {
    for (const q of ["", "   ", "***", '""', "-", "a", "( )"])
      expect(buildMatchQuery(q)).toBeNull();
  });

  it("returns the words typed for marking a preview", () => {
    expect(buildMatchQuery('Merge "the Gate"')?.terms).toEqual([
      "merge",
      "the",
      "gate",
    ]);
  });
});
