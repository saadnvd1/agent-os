// The session a link's ref names, archived ones included: what the page asks
// when its list doesn't have it (lib/session-url).

import { db } from "../db";
import { pickSession, type SessionRef } from "../session-url";
import { isUuid, SHORT_ID_LEN } from "../session-slug";

export interface ResolvedSession {
  id: string;
  name: string;
  archived: boolean;
}

interface Row {
  id: string;
  name: string;
  archived_at: string | null;
  created_at: string | null;
}

const ID_SHAPE = /^[A-Za-z0-9_-]{1,128}$/;
const SHORT = new RegExp(`^[0-9a-f]{${SHORT_ID_LEN}}$`);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The ref a request's `ref` and `slug` params name, or null when malformed. */
export function refFromParams(
  ref: string | null,
  slug: string | null
): SessionRef | null {
  if (!ref) return null;
  if (SHORT.test(ref)) {
    return { short: ref, slug: slug && SLUG.test(slug) ? slug : null };
  }
  // A whole id; never a shorter prefix, which would let a caller walk the table.
  if (isUuid(ref) || (ID_SHAPE.test(ref) && ref.length > SHORT_ID_LEN))
    return { id: ref };
  return null;
}

export function resolveSessionRef(ref: SessionRef): ResolvedSession | null {
  const cols = `id, name, archived_at, created_at`;
  const rows =
    "id" in ref
      ? (db
          .prepare(`SELECT ${cols} FROM sessions WHERE id = ?`)
          .all(ref.id) as Row[])
      : // A range on the key, so the index finds the prefix.
        (db
          .prepare(`SELECT ${cols} FROM sessions WHERE id >= ? AND id < ?`)
          .all(ref.short, `${ref.short}~`) as Row[]);
  const hit = pickSession(ref, rows);
  return hit
    ? { id: hit.id, name: hit.name, archived: hit.archived_at !== null }
    : null;
}
