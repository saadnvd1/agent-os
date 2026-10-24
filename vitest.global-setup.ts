import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  realpathSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import {
  RUN_PREFIX,
  exists,
  leaks,
  rmTree,
  runRootBase,
  snapshot,
  sweepStale,
  testTmpPrefixes,
  worktreeLeaks,
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
  const base = runRootBase(real);

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
    let removed = 0;
    let failed = 0;
    for (const dir of new Set([real, base])) {
      const r = sweepStale(dir);
      removed += r.removed;
      failed += r.failed;
    }
    if (removed || failed)
      console.log(
        `test temp sweep: removed ${removed} old leftover(s)${failed ? `, ${failed} could not be removed` : ""}`
      );
  }

  const prefixes = testTmpPrefixes(process.cwd());
  const watched = [
    ...new Set([
      real,
      base,
      ...(process.platform === "darwin" ? ["/tmp"] : []),
    ]),
  ];
  const before = new Map(watched.map((d) => [d, snapshot(d, prefixes)]));

  // The real worktrees folder, by the account's home (HOME is replaced in
  // each test file). A test whose throwaway repository's worktree lands here
  // fails the run: it is how 3,800 folders piled up.
  const realWorktrees = join(userInfo().homedir, ".agent-os", "worktrees");
  const worktreesBefore = new Set(
    (() => {
      try {
        return readdirSync(realWorktrees);
      } catch {
        return [];
      }
    })()
  );

  let made: string;
  try {
    made = mkdtempSync(join(base, RUN_PREFIX));
  } catch {
    made = mkdtempSync(join(real, RUN_PREFIX));
  }
  // Canonical (/private/tmp on a Mac): code that resolves symlinks must agree
  // with the paths the tests built.
  const root = realpathSync(made);
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
    for (const name of worktreeLeaks(realWorktrees, worktreesBefore, [
      root,
      made,
    ]))
      problems.push(
        `worktree left in the real home: ${join(realWorktrees, name)}`
      );
    process.env.TMPDIR = real;
    if (problems.length) {
      process.exitCode = 1;
      throw new Error(
        `the test run left temp files behind:\n  ${problems.join("\n  ")}`
      );
    }
  };
}
