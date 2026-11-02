// The "deploy now" request a click leaves for scripts/autodeploy, which owns
// deploys on its machine: $AGENT_OS_HOME/autodeploy/now. The script skips the
// restart gap and the settle wait for it and removes it once the deploy ran.

import fs from "fs";
import path from "path";

/** autodeploy ignores a request older than this (its find -mmin +30). */
export const REQUEST_FRESH_MS = 30 * 60_000;

export function readDeployRequest(
  file: string,
  now: number
): { requestedAt: number } | null {
  try {
    const at = Number(fs.readFileSync(file, "utf8").trim());
    if (Number.isFinite(at) && now - at < REQUEST_FRESH_MS)
      return { requestedAt: at };
  } catch {}
  return null;
}

/** Written to a temp name and renamed, so the script never sees half a file. */
export function writeDeployRequest(file: string, now: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${now}\n`);
  fs.renameSync(tmp, file);
}
