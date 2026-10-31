import { git } from "@/lib/git-exec";
import { fileSchema, type Entry } from "./schema";
import { byNewest, WHATS_NEW_FILE } from "./load";

/**
 * What an update that is waiting would add: the entries in the changelog at
 * the latest commit the update check already fetched, minus the ones this
 * install has. No network; the commit is in the local object store.
 */
export async function aheadEntries(
  sha: string | null | undefined,
  installed: Entry[],
  cwd: string = process.cwd()
): Promise<Entry[]> {
  if (!sha || !/^[0-9a-f]{7,40}$/.test(sha)) return [];
  try {
    const raw = await git(cwd, ["show", `${sha}:${WHATS_NEW_FILE}`], {
      timeout: 10_000,
    });
    const have = new Set(installed.map((e) => e.id));
    return fileSchema
      .parse(JSON.parse(raw))
      .entries.filter((e) => !e.hidden && !have.has(e.id))
      .sort(byNewest);
  } catch {
    return [];
  }
}
