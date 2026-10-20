// Each sync: tells a local session about a strong overlap it is in. An
// overlap must hold on two syncs in a row, and is told again only when the
// shared set grows. Both machines run this for their own sessions, so
// nothing is sent across machines. Never pauses or stops anything.

import { getDb } from "../db";
import { sendMessage } from "../bus";
import { machineId } from "./machine";
import { sessionOverlaps, type SessionOverlap } from "./mine";
import { sessionMessage } from "./overlapText";
import { liveClaims } from "./store";

export const HOLD_SYNCS = 2;
// A told pair that has not overlapped for this long is forgotten.
const FORGET_MS = 60 * 60_000;

export type Tell = (sessionId: string, body: string) => Promise<void>;

export const tellSession: Tell = async (sessionId, body) => {
  await sendMessage({
    fromId: null,
    to: sessionId,
    body,
    fromLabel: "AgentOS",
    origin: { kind: "system", label: "Overlap", body },
  });
};

interface Notice {
  pair_key: string;
  hits: number;
  shared: string;
  told_at: number | null;
  seen_at: number;
}

const parse = (raw: string): string[] => {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export async function notifyOverlaps(
  tell: Tell = tellSession,
  now = Date.now()
): Promise<number> {
  const db = getDb();
  const byPair = new Map<string, SessionOverlap[]>();
  for (const o of sessionOverlaps(machineId(), liveClaims({ now })))
    byPair.set(o.pairKey, [...(byPair.get(o.pairKey) ?? []), o]);
  const get = db.prepare(`SELECT * FROM claim_notices WHERE pair_key = ?`);
  const save = db.prepare(
    `INSERT INTO claim_notices (pair_key, hits, shared, told_at, seen_at)
     VALUES (@key, @hits, @shared, @told, @now)
     ON CONFLICT(pair_key) DO UPDATE SET hits = @hits, shared = @shared,
       told_at = @told, seen_at = @now`
  );
  let told = 0;
  for (const [key, sides] of byPair) {
    const row = get.get(key) as Notice | undefined;
    const hits = (row?.hits ?? 0) + 1;
    const shared = sides[0].shared;
    const known = new Set(parse(row?.shared ?? "[]"));
    const grew = !!row?.told_at && shared.some((f) => !known.has(f));
    const due = hits >= HOLD_SYNCS && (!row?.told_at || grew);
    let delivered = false;
    if (due)
      for (const side of sides)
        try {
          await tell(side.sessionId, sessionMessage(side));
          delivered = true;
        } catch {
          // Left untold when nobody got it: the next sync tries again.
        }
    if (delivered) told++;
    save.run({
      key,
      hits,
      shared: delivered ? JSON.stringify(shared) : (row?.shared ?? "[]"),
      told: delivered ? now : (row?.told_at ?? null),
      now,
    });
  }
  // Consecutive means consecutive: a pair that dropped out starts again.
  const rows = db.prepare(`SELECT * FROM claim_notices`).all() as Notice[];
  for (const r of rows) {
    if (byPair.has(r.pair_key)) continue;
    if (!r.told_at || now - r.seen_at > FORGET_MS)
      db.prepare(`DELETE FROM claim_notices WHERE pair_key = ?`).run(
        r.pair_key
      );
    else if (r.hits)
      db.prepare(`UPDATE claim_notices SET hits = 0 WHERE pair_key = ?`).run(
        r.pair_key
      );
  }
  return told;
}
