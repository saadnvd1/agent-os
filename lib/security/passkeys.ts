/**
 * Passkeys that prove a person is approving: one per browser and host
 * (a passkey belongs to the host name it was made on). Only public keys
 * are kept.
 */

import { getDb } from "@/lib/db";

export interface PasskeyRow {
  id: string;
  public_key: Buffer;
  counter: number;
  transports: string | null;
  rp_id: string;
  name: string;
  registered_via: string | null;
  registered_from: string | null;
  user_agent: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export type PasskeyView = Omit<PasskeyRow, "public_key" | "counter">;

const VIEW = `id, transports, rp_id, name, registered_via, registered_from,
  user_agent, created_at, last_used_at, revoked_at`;

export function listPasskeys(): PasskeyView[] {
  return getDb()
    .prepare(
      `SELECT ${VIEW} FROM passkeys WHERE revoked_at IS NULL ORDER BY created_at DESC`
    )
    .all() as PasskeyView[];
}

export function activePasskeys(rpId: string): PasskeyRow[] {
  return getDb()
    .prepare(`SELECT * FROM passkeys WHERE rp_id = ? AND revoked_at IS NULL`)
    .all(rpId) as PasskeyRow[];
}

export function activePasskeyCount(): number {
  return (
    getDb()
      .prepare(`SELECT COUNT(*) AS n FROM passkeys WHERE revoked_at IS NULL`)
      .get() as { n: number }
  ).n;
}

export function getPasskey(id: string): PasskeyRow | null {
  return (
    (getDb().prepare(`SELECT * FROM passkeys WHERE id = ?`).get(id) as
      | PasskeyRow
      | undefined) ?? null
  );
}

export function addPasskey(p: {
  id: string;
  publicKey: Uint8Array;
  counter: number;
  transports?: string[];
  rpId: string;
  name: string;
  via: string;
  from: string | null;
  userAgent: string | null;
}): PasskeyRow {
  getDb()
    .prepare(
      `INSERT INTO passkeys (id, public_key, counter, transports, rp_id, name,
         registered_via, registered_from, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      p.id,
      Buffer.from(p.publicKey),
      p.counter,
      p.transports ? JSON.stringify(p.transports) : null,
      p.rpId,
      p.name.trim().slice(0, 80) || "Passkey",
      p.via,
      p.from,
      p.userAgent?.slice(0, 300) ?? null
    );
  return getPasskey(p.id)!;
}

export function touchPasskey(id: string, counter: number): void {
  getDb()
    .prepare(
      `UPDATE passkeys SET counter = ?, last_used_at = datetime('now') WHERE id = ?`
    )
    .run(counter, id);
}

export function revokePasskey(id: string): boolean {
  return (
    getDb()
      .prepare(
        `UPDATE passkeys SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL`
      )
      .run(id).changes > 0
  );
}
