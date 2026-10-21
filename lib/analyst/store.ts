import { randomUUID } from "crypto";
import { db } from "../db";
import {
  AnalystError,
  type AnalystLink,
  type DigestSignals,
  type Issue,
  type Recommendation,
  type RecommendationState,
  type Verdict,
} from "./types";

interface LinkRow {
  id: string;
  coder_session_id: string;
  analyst_session_id: string;
  paused: number;
  reviewed_through: string | null;
  pending_digest_id: string | null;
  pending_through: string | null;
  digest_signals: string | null;
  created_at: number;
  ended_at: number | null;
}

interface RecRow {
  id: string;
  link_id: string;
  analyst_item_id: string;
  coder_through: string | null;
  verdict: string | null;
  summary: string;
  issues: string;
  signals: string | null;
  prompt: string | null;
  state: string;
  error: string | null;
  sent_text: string | null;
  sent_item_id: string | null;
  edited: number;
  created_at: number;
  decided_at: number | null;
}

const parse = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

const toLink = (r: LinkRow): AnalystLink => ({
  id: r.id,
  coderSessionId: r.coder_session_id,
  analystSessionId: r.analyst_session_id,
  paused: !!r.paused,
  reviewedThrough: r.reviewed_through,
  pendingDigestId: r.pending_digest_id,
  pendingThrough: r.pending_through,
  digestSignals: parse<DigestSignals | null>(r.digest_signals, null),
  createdAt: r.created_at,
  endedAt: r.ended_at,
});

const toRec = (r: RecRow): Recommendation => ({
  id: r.id,
  linkId: r.link_id,
  analystItemId: r.analyst_item_id,
  coderThrough: r.coder_through,
  verdict: r.verdict as Verdict | null,
  summary: r.summary,
  issues: parse<Issue[]>(r.issues, []),
  signals: parse<DigestSignals | null>(r.signals, null),
  prompt: r.prompt,
  state: r.state as RecommendationState,
  error: r.error,
  sentText: r.sent_text,
  sentItemId: r.sent_item_id,
  edited: !!r.edited,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
});

export function getLink(id: string): AnalystLink | null {
  const r = db.prepare(`SELECT * FROM analyst_links WHERE id = ?`).get(id) as
    LinkRow | undefined;
  return r ? toLink(r) : null;
}

export function getLinkOrThrow(id: string): AnalystLink {
  const link = getLink(id);
  if (!link) throw new AnalystError("Pairing not found", 404);
  return link;
}

// The live link a session is in, on either side.
export function liveLinkFor(sessionId: string): AnalystLink | null {
  const r = db
    .prepare(
      `SELECT * FROM analyst_links WHERE ended_at IS NULL
         AND (coder_session_id = ? OR analyst_session_id = ?)`
    )
    .get(sessionId, sessionId) as LinkRow | undefined;
  return r ? toLink(r) : null;
}

// Any link, live or ended, the session was the analyst of.
export function linkOfAnalyst(sessionId: string): AnalystLink | null {
  const r = db
    .prepare(`SELECT * FROM analyst_links WHERE analyst_session_id = ?`)
    .get(sessionId) as LinkRow | undefined;
  return r ? toLink(r) : null;
}

export function liveLinks(): AnalystLink[] {
  return (
    db
      .prepare(`SELECT * FROM analyst_links WHERE ended_at IS NULL`)
      .all() as LinkRow[]
  ).map(toLink);
}

export function insertLink(
  coderSessionId: string,
  analystSessionId: string,
  reviewedThrough: string | null
): AnalystLink {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO analyst_links (id, coder_session_id, analyst_session_id,
       reviewed_through, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(id, coderSessionId, analystSessionId, reviewedThrough, Date.now());
  return getLink(id)!;
}

export function setPausedRow(id: string, paused: boolean): void {
  db.prepare(`UPDATE analyst_links SET paused = ? WHERE id = ?`).run(
    paused ? 1 : 0,
    id
  );
}

export function endLinkRow(id: string): boolean {
  return (
    db
      .prepare(
        `UPDATE analyst_links SET ended_at = ? WHERE id = ? AND ended_at IS NULL`
      )
      .run(Date.now(), id).changes > 0
  );
}

// Recorded before the digest is sent, so a restart can send it again.
export function markDigestPending(
  id: string,
  digestId: string,
  through: string,
  signals: DigestSignals
): void {
  db.prepare(
    `UPDATE analyst_links SET pending_digest_id = ?, pending_through = ?,
       digest_signals = ? WHERE id = ?`
  ).run(digestId, through, JSON.stringify(signals), id);
}

// The analyst answered the digest: its turns count as reviewed.
export function settleDigest(id: string, digestId: string): boolean {
  return (
    db
      .prepare(
        `UPDATE analyst_links SET reviewed_through = pending_through,
           pending_digest_id = NULL, pending_through = NULL
         WHERE id = ? AND pending_digest_id = ?`
      )
      .run(id, digestId).changes > 0
  );
}

// A digest that never arrived: dropped, so the next one covers its turns.
export function dropPendingDigest(id: string): void {
  db.prepare(
    `UPDATE analyst_links SET pending_digest_id = NULL, pending_through = NULL
      WHERE id = ?`
  ).run(id);
}

export function listRecommendations(
  linkId: string,
  limit = 20
): Recommendation[] {
  return (
    db
      .prepare(
        `SELECT * FROM analyst_recommendations WHERE link_id = ?
          ORDER BY created_at DESC, rowid DESC LIMIT ?`
      )
      .all(linkId, limit) as RecRow[]
  ).map(toRec);
}

export function getRecommendation(id: string): Recommendation | null {
  const r = db
    .prepare(`SELECT * FROM analyst_recommendations WHERE id = ?`)
    .get(id) as RecRow | undefined;
  return r ? toRec(r) : null;
}

export function recommendationFor(
  linkId: string,
  analystItemId: string
): Recommendation | null {
  const r = db
    .prepare(
      `SELECT * FROM analyst_recommendations WHERE link_id = ? AND analyst_item_id = ?`
    )
    .get(linkId, analystItemId) as RecRow | undefined;
  return r ? toRec(r) : null;
}

export interface NewRecommendation {
  linkId: string;
  analystItemId: string;
  coderThrough: string | null;
  verdict: Verdict | null;
  summary: string;
  issues: Issue[];
  signals: DigestSignals | null;
  prompt: string | null;
  state: "open" | "invalid";
  error?: string | null;
}

// Once per analyst reply: a repeat is a no-op. A new one retires the
// cards still open, so only one is ever actionable.
export function insertRecommendation(
  r: NewRecommendation
): Recommendation | null {
  const id = randomUUID();
  const inserted = db.transaction(() => {
    const changes = db
      .prepare(
        `INSERT OR IGNORE INTO analyst_recommendations (id, link_id,
           analyst_item_id, coder_through, verdict, summary, issues, signals,
           prompt, state, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        r.linkId,
        r.analystItemId,
        r.coderThrough,
        r.verdict,
        r.summary,
        JSON.stringify(r.issues),
        r.signals ? JSON.stringify(r.signals) : null,
        r.prompt,
        r.state,
        r.error ?? null,
        Date.now()
      ).changes;
    if (!changes) return false;
    db.prepare(
      `UPDATE analyst_recommendations SET state = 'superseded', decided_at = ?
        WHERE link_id = ? AND id != ? AND state IN ('open', 'invalid')`
    ).run(Date.now(), r.linkId, id);
    return true;
  })();
  return inserted ? getRecommendation(id) : null;
}

// Moves an open card to its decision, once: false when it was decided.
export function decideRecommendation(
  id: string,
  state: "sent" | "dismissed",
  sent?: { text: string; itemId: string; edited: boolean }
): boolean {
  return (
    db
      .prepare(
        `UPDATE analyst_recommendations SET state = ?, decided_at = ?,
           sent_text = ?, sent_item_id = ?, edited = ?
         WHERE id = ? AND state IN ('open', 'invalid')`
      )
      .run(
        state,
        Date.now(),
        sent?.text ?? null,
        sent?.itemId ?? null,
        sent?.edited ? 1 : 0,
        id
      ).changes > 0
  );
}

// Back to open: a send that failed after the card was claimed.
export function reopenRecommendation(id: string): void {
  db.prepare(
    `UPDATE analyst_recommendations SET state = 'open', decided_at = NULL,
       sent_text = NULL, sent_item_id = NULL, edited = 0 WHERE id = ?`
  ).run(id);
}
