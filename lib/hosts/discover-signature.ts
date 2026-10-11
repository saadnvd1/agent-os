import { getDb, queries } from "../db";
import { statusDetector } from "../status-detector";
import {
  discoverSessions,
  type ManagedTmux,
  type ProjectFolder,
} from "./discover";

// What the discovered-sessions list shows, minus activity times: when this
// changes, browsers refetch /api/tmux/discover (pushed as "discovered").
// Reads the status detector's last list-sessions, so it runs no tmux.
//
// The status hub asks once a second while anyone watches. The answer only
// moves when the sessions or projects tables are written or tmux is listed
// anew, so it's recomputed only then, from the columns matching reads.
let last: { versions: string; listing: object; signature: string } | null =
  null;

function tableVersions(): string {
  const rows = getDb()
    .prepare(
      `SELECT topic, version FROM change_versions WHERE topic IN ('sessions', 'projects') ORDER BY topic`
    )
    .all() as { topic: string; version: number }[];
  return rows.map((r) => `${r.topic}:${r.version}`).join(",");
}

export function discoveredSignature(): string {
  const versions = tableVersions();
  const listing = statusDetector.listingStamp();
  if (last && last.versions === versions && last.listing === listing)
    return last.signature;
  const db = getDb();
  const found = discoverSessions(
    statusDetector.cachedSessions(),
    queries.getProjectFolders(db).all() as ProjectFolder[],
    queries.getManagedTmuxNames(db).all() as ManagedTmux[]
  );
  const signature = JSON.stringify([
    found.map((s) => [s.hostId, s.name, s.projectId, s.path]).sort(),
    statusDetector.hostErrors(),
  ]);
  last = { versions, listing, signature };
  return signature;
}

/** Forget the remembered answer (tests). */
export function resetDiscoveredSignature(): void {
  last = null;
}
