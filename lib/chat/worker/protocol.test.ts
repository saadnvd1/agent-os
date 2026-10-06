import { describe, expect, it } from "vitest";
import { lineReader, workerDir } from "./protocol";

describe("lineReader", () => {
  it("joins messages split across chunks and skips blank lines", () => {
    const got: unknown[] = [];
    const read = lineReader((m) => got.push(m));
    read(Buffer.from('{"a":1}\n{"b":'));
    read(Buffer.from('2}\n\n{"c":3}'));
    expect(got).toEqual([{ a: 1 }, { b: 2 }]);
    read(Buffer.from("\n"));
    expect(got).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });
});

describe("workerDir", () => {
  it("is separate per database", () => {
    const before = process.env.DB_PATH;
    process.env.DB_PATH = "/tmp/a.db";
    const a = workerDir();
    process.env.DB_PATH = "/tmp/b.db";
    const b = workerDir();
    process.env.DB_PATH = before;
    expect(a).not.toBe(b);
  });
});
