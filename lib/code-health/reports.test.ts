import { describe, expect, it } from "vitest";
import {
  slowTests,
  summarizeBundle,
  summarizeEslint,
  summarizeNpmAudit,
  summarizeOutdated,
} from "./reports";
import { compareMetrics, metrics, type Prepass } from "./summary";

describe("summarizeNpmAudit", () => {
  it("counts every severity and details only high and critical", () => {
    const out = summarizeNpmAudit({
      metadata: { vulnerabilities: { low: 2, high: 1, critical: 1, total: 4 } },
      vulnerabilities: {
        lodash: { severity: "low", via: ["x"] },
        next: {
          severity: "high",
          isDirect: true,
          via: [{ title: "SSRF in image optimizer" }, "postcss"],
          fixAvailable: {
            name: "next",
            version: "16.0.1",
            isSemVerMajor: true,
          },
        },
        tar: {
          severity: "critical",
          via: [{ title: "Path traversal" }],
          fixAvailable: true,
        },
      },
    });
    expect(out.counts).toEqual({ low: 2, high: 1, critical: 1, total: 4 });
    expect(out.serious).toEqual([
      {
        name: "tar",
        severity: "critical",
        direct: false,
        via: ["Path traversal"],
        fix: "npm audit fix",
      },
      {
        name: "next",
        severity: "high",
        direct: true,
        via: ["SSRF in image optimizer", "postcss"],
        fix: "next@16.0.1 (major)",
      },
    ]);
  });

  it("reads an empty or broken report as nothing", () => {
    expect(summarizeNpmAudit(null)).toEqual({ counts: {}, serious: [] });
  });
});

describe("summarizeOutdated", () => {
  it("puts packages a major version behind first", () => {
    const out = summarizeOutdated({
      zod: { current: "3.22.0", wanted: "3.23.0", latest: "3.23.0" },
      react: { current: "18.3.1", wanted: "18.3.1", latest: "19.1.0" },
      gone: { wanted: "1.0.0", latest: "1.0.0" },
    });
    expect(out.map((o) => [o.name, o.majorBehind])).toEqual([
      ["react", true],
      ["gone", false],
      ["zod", false],
    ]);
    expect(out[1].current).toBe("missing");
  });
});

describe("summarizeEslint", () => {
  it("totals, ranks rules and files, with paths relative to the root", () => {
    const out = summarizeEslint(
      [
        {
          filePath: "/repo/a.ts",
          errorCount: 1,
          warningCount: 2,
          messages: [
            { ruleId: "no-unused-vars" },
            { ruleId: "no-unused-vars" },
            { ruleId: null },
          ],
        },
        {
          filePath: "/repo/b.ts",
          errorCount: 0,
          warningCount: 0,
          messages: [],
        },
        {
          filePath: "/repo/c.ts",
          errorCount: 0,
          warningCount: 1,
          messages: [{ ruleId: "eqeqeq" }],
        },
      ],
      "/repo"
    );
    expect(out).toEqual({
      errors: 1,
      warnings: 3,
      byRule: [
        { rule: "no-unused-vars", count: 2 },
        { rule: "(parse)", count: 1 },
        { rule: "eqeqeq", count: 1 },
      ],
      topFiles: [
        { path: "a.ts", warnings: 2, errors: 1 },
        { path: "c.ts", warnings: 1, errors: 0 },
      ],
    });
  });
});

describe("slowTests", () => {
  it("ranks files by wall time and tests by duration", () => {
    const out = slowTests(
      {
        testResults: [
          {
            name: "/repo/lib/a.test.ts",
            startTime: 1000,
            endTime: 1500,
            assertionResults: [{ fullName: "a works", duration: 400.4 }],
          },
          {
            name: "/repo/lib/b.test.ts",
            startTime: 1000,
            endTime: 4000,
            assertionResults: [
              { fullName: "b one", duration: 10 },
              { fullName: "b two", duration: 2900 },
            ],
          },
        ],
      },
      "/repo",
      1
    );
    expect(out).toEqual({
      totalMs: 3500,
      files: [{ path: "lib/b.test.ts", ms: 3000, tests: 2 }],
      tests: [{ name: "b two", path: "lib/b.test.ts", ms: 2900 }],
    });
  });
});

describe("summarizeBundle", () => {
  it("reports first-load KB per route and the largest chunks", () => {
    const out = summarizeBundle(
      [
        {
          route: "/pair",
          firstLoadUncompressedJsBytes: 512 * 1024,
          firstLoadChunkPaths: ["a"],
        },
        {
          route: "/",
          firstLoadUncompressedJsBytes: 1024 * 1024,
          firstLoadChunkPaths: ["a", "b"],
        },
      ],
      [
        { file: "a.js", bytes: 2048 },
        { file: "b.js", bytes: 300 * 1024 },
      ],
      1
    );
    expect(out).toEqual({
      routes: [
        { route: "/", firstLoadKB: 1024, chunks: 2 },
        { route: "/pair", firstLoadKB: 512, chunks: 1 },
      ],
      largestChunks: [{ file: "b.js", kb: 300 }],
    });
  });
});

describe("metrics and compareMetrics", () => {
  const base: Prepass = {
    id: "2026-10-10-2000",
    generatedAt: "",
    commit: "",
    files: { code: 1, tests: 0, lines: 1 },
    collectors: {},
  };

  it("leaves out what a run didn't collect", () => {
    expect(metrics(base)).toEqual({});
    expect(
      metrics({
        ...base,
        duplicates: { window: 10, blocks: [], duplicatedLines: 7 },
      })
    ).toEqual({ "duplicated lines": 7 });
  });

  it("says which way each number moved, and nothing on a first run", () => {
    expect(compareMetrics(null, { a: 1 })).toEqual([]);
    expect(
      compareMetrics(
        { a: 5, b: 1, c: 2, gone: 1 },
        { a: 3, b: 4, c: 2, fresh: 0 }
      )
    ).toEqual([
      { metric: "a", before: 5, after: 3, change: "better" },
      { metric: "b", before: 1, after: 4, change: "worse" },
      { metric: "c", before: 2, after: 2, change: "same" },
      { metric: "gone", before: 1, after: null, change: "gone" },
      { metric: "fresh", before: null, after: 0, change: "new" },
    ]);
  });
});
