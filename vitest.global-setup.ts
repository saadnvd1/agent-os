import { execFileSync } from "node:child_process";
import { mkdtempSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import {
  RUN_PREFIX,
  exists,
  leaks,
  rmTree,
  snapshot,
  sweepStale,
  testTmpPrefixes,
} from "./vitest.tmp";

const SWEEP_EVERY_MS = 60 * 60 * 1000;

// Every test's temp dirs live under one root made here and removed in
// teardown (see vitest.setup.ts). Leftovers of killed runs, and of runs from
// before this existed, are swept when they're a day old. The run fails if it
// leaves anything of its own in the real temp folder.
export default function setup(project: TestProject) {
  // lib/db/migrations.ts imports a generated index of lib/db/migrations/;
  // build it once before any worker loads the module.
  execFileSync(process.execPath, ["scripts/gen-migrations-index.mjs"], {
    stdio: "inherit",
  });

  const real = process.env.TMPDIR || tmpdir();
  process.env.AGENTOS_TEST_REAL_TMPDIR = real;

  // At most once an hour across concurrent runs.
  const stamp = join(real, `${RUN_PREFIX}sweep.stamp`);
  let due = true;
  try {
    due = Date.now() - statSync(stamp).mtimeMs > SWEEP_EVERY_MS;
  } catch {
    // no stamp yet
  }
  if (due) {
    try {
      writeFileSync(stamp, "");
      utimesSync(stamp, new Date(), new Date());
    } catch {
      // read-only temp: the sweep below still runs
    }
    const { removed, failed } = sweepStale(real);
    if (removed || failed)
      console.log(
        `test temp sweep: removed ${removed} old leftover(s)${failed ? `, ${failed} could not be removed` : ""}`
      );
  }

  const prefixes = testTmpPrefixes(process.cwd());
  const watched = [
    ...new Set([real, ...(process.platform === "darwin" ? ["/tmp"] : [])]),
  ];
  const before = new Map(watched.map((d) => [d, snapshot(d, prefixes)]));

  const root = mkdtempSync(join(real, RUN_PREFIX));
  process.env.TMPDIR = root;
  project.provide("tmpRoot", root);

  return () => {
    const problems: string[] = [];
    if (exists(root)) {
      try {
        rmTree(root);
      } catch {
        // checked below
      }
    }
    if (exists(root)) problems.push(`not removed: ${root}`);
    for (const dir of watched)
      for (const name of leaks(dir, prefixes, before.get(dir) ?? new Set()))
        problems.push(`left behind: ${join(dir, name)}`);
    process.env.TMPDIR = real;
    if (problems.length) {
      process.exitCode = 1;
      throw new Error(
        `the test run left temp files behind:\n  ${problems.join("\n  ")}`
      );
    }
  };
}
