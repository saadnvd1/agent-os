import { isCode, reachedFrom, type Graph } from "./importGraph";
import type { Change, CheckScope } from "./types";

// A change here can break any test, so the whole suite runs.
export const SHARED = [
  /^package\.json$/,
  /^pnpm-(?:lock|workspace)\.yaml$/,
  /^tsconfig[^/]*\.json$/,
  /^vitest\.[^/]+$/,
  /^lib\/test-(?:temp|home-guard)\.ts$/,
  /^lib\/db\/(?!migrations\/)[^/]+$/,
  /^scripts\/(?:check|test)$/,
  /^lib\/check-scope\//,
  /^scripts\/check-scope\.ts$/,
];

// Tests that read these folders as data rather than importing them.
const READERS: [RegExp, string[]][] = [
  [/^docs\//, ["scripts/docs-links.test.ts"]],
  [/^content\//, ["scripts/tips-lint.test.ts", "scripts/docs-links.test.ts"]],
];

const LINTED = /\.(?:[cm]?[jt]sx?)$/;
const TEST = /\.test\.ts$/;

export function selectChecks(input: {
  changes: Change[];
  files: string[];
  graph: Graph;
  full?: boolean;
}): CheckScope {
  const { changes, files, graph } = input;
  const live = changes.filter((c) => !c.deleted).map((c) => c.path);
  const touched = new Set(
    changes.flatMap((c) => (c.from ? [c.path, c.from] : [c.path]))
  );
  const base = {
    changed: touched.size,
    lint: live.filter((p) => LINTED.test(p)),
    format: live,
  };
  if (input.full)
    return {
      ...base,
      full: true,
      reason: "asked for the full suite",
      tests: [],
    };
  const shared = [...touched].find((p) => SHARED.some((re) => re.test(p)));
  if (shared)
    return {
      ...base,
      full: true,
      reason: `${shared} is shared by the whole suite`,
      tests: [],
    };

  const tests = new Set<string>();
  const testFiles = files.filter((f) => TEST.test(f));
  for (const file of reachedFrom(
    [...touched].filter((p) => isCode(p)),
    graph.importers
  ))
    if (TEST.test(file)) tests.add(file);
  // Tests that run or read a file by its path, not by importing it.
  const named = [...touched].filter((p) => !/\.tsx?$/.test(p));
  if (named.length)
    for (const test of testFiles) {
      const text = graph.read(test);
      if (named.some((p) => text.includes(p))) tests.add(test);
    }
  for (const [re, readers] of READERS)
    if ([...touched].some((p) => re.test(p)))
      for (const r of readers) if (files.includes(r)) tests.add(r);
  const gone = new Set(
    changes.flatMap((c) => (c.deleted ? [c.path] : c.from ? [c.from] : []))
  );
  return {
    ...base,
    full: false,
    reason: "tests related to the changed files",
    tests: [...tests].filter((t) => !gone.has(t)).sort(),
  };
}
