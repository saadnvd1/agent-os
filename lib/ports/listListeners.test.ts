import { describe, expect, it } from "vitest";
import { parseLsofCwds, parseLsofListeners } from "./listListeners";

describe("parseLsofListeners", () => {
  it("is one listener per pid and port, v4 and v6 folded", () => {
    const out = [
      "p4121",
      "cnode",
      "f22",
      "n*:3000",
      "f23",
      "n[::]:3000",
      "p99",
      "cpostgres",
      "f5",
      "n127.0.0.1:5432",
      "",
    ].join("\n");
    expect(parseLsofListeners(out)).toEqual([
      { port: 3000, pid: 4121, command: "node", cwd: null },
      { port: 5432, pid: 99, command: "postgres", cwd: null },
    ]);
  });

  it("is empty for nothing listening", () => {
    expect(parseLsofListeners("")).toEqual([]);
  });
});

describe("parseLsofCwds", () => {
  it("maps each pid to its cwd", () => {
    expect(parseLsofCwds("p1\nfcwd\nn/a\np2\nfcwd\nn/b b\n")).toEqual(
      new Map([
        [1, "/a"],
        [2, "/b b"],
      ])
    );
  });
});
