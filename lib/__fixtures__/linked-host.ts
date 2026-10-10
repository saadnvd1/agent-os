import { randomUUID } from "crypto";
import { getDb } from "../db";

/** A machine linked to (a fake of) its AgentOS, in the test database. */
export function linkedHost(
  url: string,
  token: string
): {
  hostId: string;
  remove: () => void;
} {
  const hostId = randomUUID();
  const db = getDb();
  db.prepare(
    `INSERT INTO hosts (id, name, ssh_target) VALUES (?, 'box', 'me@box')`
  ).run(hostId);
  db.prepare(
    `INSERT INTO host_links (host_id, url, token) VALUES (?, ?, ?)`
  ).run(hostId, url, token);
  return {
    hostId,
    remove: () => {
      db.prepare(`DELETE FROM sessions WHERE host_id = ?`).run(hostId);
      db.prepare(`DELETE FROM hosts WHERE id = ?`).run(hostId);
    },
  };
}
