import { getDb, queries, type Project, type Session } from "../db";
import { statusDetector } from "../status-detector";
import { discoverSessions } from "./discover";

// What the discovered-sessions list shows, minus activity times: when this
// changes, browsers refetch /api/tmux/discover (pushed as "discovered").
// Reads the status detector's last list-sessions, so it runs no tmux.
export function discoveredSignature(): string {
  const db = getDb();
  const found = discoverSessions(
    statusDetector.cachedSessions(),
    queries.getAllProjects(db).all() as Project[],
    queries.getAllSessions(db).all() as Session[]
  );
  return JSON.stringify([
    found.map((s) => [s.hostId, s.name, s.projectId, s.path]).sort(),
    statusDetector.hostErrors(),
  ]);
}
