/**
 * Path checks shared by what setup places into a worktree (agentos.json's
 * `copy`, `clone` and `caches`): everything resolved through symlinks to a
 * place inside its checkout, so a link can't carry a copy somewhere else.
 */

import * as fs from "fs";
import * as path from "path";

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
