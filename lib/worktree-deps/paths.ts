/**
 * Path checks shared by what setup places into a worktree (agentos.json's
 * `copy`, `clone` and `caches`): everything resolved through symlinks to a
 * place inside its checkout, so a link can't carry a copy somewhere else.
 */

import * as fs from "fs";
import * as path from "path";
import { git } from "../git-exec";

export const inside = (root: string, p: string) =>
  p === root || p.startsWith(root + path.sep);

// The real path of `p`'s deepest part that exists.
export async function realExisting(p: string): Promise<string> {
  for (let at = p; ; at = path.dirname(at)) {
    const real = await fs.promises.realpath(at).catch(() => null);
    if (real) return real;
    if (path.dirname(at) === at) return at;
  }
}

export const STAGING_SUFFIX = ".aos-partial";

const EXCLUDE_LINE = `*${STAGING_SUFFIX}`;

// Staging dirs (`node_modules.aos-partial`) sit beside their target, where git
// would list them as untracked work. Written once to the repo's shared
// info/exclude, so it covers every worktree and no .gitignore is touched.
// Best effort: outside a repository there is nothing to ignore it in.
export async function ignoreStaging(dir: string): Promise<void> {
  try {
    const common = (
      await git(dir, ["rev-parse", "--git-common-dir"], { timeout: 5000 })
    ).trim();
    if (!common) return;
    const file = path.join(path.resolve(dir, common), "info", "exclude");
    const current = await fs.promises.readFile(file, "utf8").catch(() => "");
    if (current.split(/\r?\n/).some((l) => l.trim() === EXCLUDE_LINE)) return;
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const lead = current && !current.endsWith("\n") ? "\n" : "";
    await fs.promises.appendFile(file, `${lead}${EXCLUDE_LINE}\n`);
  } catch {
    // never fails a setup
  }
}
