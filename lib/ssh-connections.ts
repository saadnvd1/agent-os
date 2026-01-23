import { getDb } from "./db";
import type { SSHConnection } from "./db/types";

export function createSSHConnection(
  data: Omit<SSHConnection, "id" | "created_at" | "updated_at" | "last_connected_at" | "status">
): SSHConnection {
  const db = getDb();
  const id = `ssh_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO ssh_connections (id, name, host, port, user, key_path, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.name, data.host, data.port, data.user, data.key_path, "disconnected", now, now);

  return {
    ...data,
    id,
    last_connected_at: null,
    status: "disconnected",
    created_at: now,
    updated_at: now,
  };
}

export function listSSHConnections(): SSHConnection[] {
  const db = getDb();
  return db.prepare("SELECT * FROM ssh_connections ORDER BY name ASC").all() as SSHConnection[];
}

export function getSSHConnectionById(id: string): SSHConnection | null {
  const db = getDb();
  return db.prepare("SELECT * FROM ssh_connections WHERE id = ?").get(id) as SSHConnection | null;
}

export function updateSSHConnection(
  id: string,
  updates: Partial<Omit<SSHConnection, "id" | "created_at" | "updated_at">>
): void {
  const db = getDb();
  const now = new Date().toISOString();
  const fields = Object.keys(updates)
    .map((k) => `${k} = ?`)
    .join(", ");
  const values = [...Object.values(updates), now, id];

  db.prepare(`UPDATE ssh_connections SET ${fields}, updated_at = ? WHERE id = ?`).run(...values);
}

export function deleteSSHConnection(id: string): void {
  const db = getDb();

  // Check if any projects use this connection
  const projects = db
    .prepare("SELECT COUNT(*) as count FROM projects WHERE ssh_connection_id = ?")
    .get(id) as { count: number };

  if (projects.count > 0) {
    throw new Error("Cannot delete SSH connection: in use by projects");
  }

  db.prepare("DELETE FROM ssh_connections WHERE id = ?").run(id);
}

export function updateSSHConnectionStatus(
  id: string,
  status: SSHConnection["status"],
  lastConnectedAt?: string
): void {
  const db = getDb();
  const now = new Date().toISOString();

  if (lastConnectedAt) {
    db.prepare(`
      UPDATE ssh_connections
      SET status = ?, last_connected_at = ?, updated_at = ?
      WHERE id = ?
    `).run(status, lastConnectedAt, now, id);
  } else {
    db.prepare(`
      UPDATE ssh_connections
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(status, now, id);
  }
}
