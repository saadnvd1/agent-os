// Whether an autodeploy runner is deploying THIS checkout on THIS machine.
// scripts/autodeploy runs from cron, so it can't leave a pid that stays
// alive; it writes the hostname and checkout path with each beat instead.
// A beat copied or synced from another machine or checkout names a different
// host or path and doesn't count.

import fs from "fs";
import os from "os";

/** autodeploy beats every minute; older means it stopped. */
export const MANAGED_FRESH_MS = 5 * 60_000;

const real = (p: string) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

export function autodeployManaged(
  file: string,
  opts: { now?: number; host?: string; cwd?: string } = {}
): boolean {
  try {
    const now = opts.now ?? Date.now();
    // A beat from the future (a skewed clock, a copied file) proves nothing.
    const age = now - fs.statSync(file).mtimeMs;
    if (age >= MANAGED_FRESH_MS || age < -60_000) return false;
    const [host, dir] = fs.readFileSync(file, "utf8").split("\n");
    return (
      !!host &&
      !!dir &&
      host === (opts.host ?? os.hostname()) &&
      real(dir) === real(opts.cwd ?? process.cwd())
    );
  } catch {
    return false;
  }
}
