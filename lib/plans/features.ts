// A plan that split into pieces: the feature, its pieces, and the one-time
// checks that turn a plan file into rows. A one-piece plan makes none.

import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { db, type Session } from "../db";
import { loadProjectConfig } from "../project-config";
import { repoSlugSync, slugOfRemote } from "../git-remote";
import {
  applyEdits,
  checkPieces,
  parseEdits,
  type CheckContext,
  type Folded,
  type PiecesResult,
  type Piece,
  type ProjectRef,
} from "./pieces";

export type PieceStatus =
  | "waiting"
  | "building"
  | "merged"
  | "blocked"
  | "dropped";

export interface Feature {
  id: string;
  workspace_id: string;
  name: string;
  plan_session_id: string;
  plan_text: string;
  status: "building" | "done" | "dropped";
  done_at: string | null;
  cost_usd: number | null;
  duration_ms: number | null;
  created_at: string;
  // Items the plan's Pieces block listed, and what the checker folded.
  listed: number | null;
  folded: string | null;
}

export interface FeaturePiece {
  id: number;
  feature_id: string;
  position: number;
  name: string;
  slice: string;
  project_id: string;
  after_position: number | null;
  after_kind: "merged" | "deployed" | null;
  reasons: string | null;
  owns: string | null;
  status: PieceStatus;
  session_id: string | null;
  note: string | null;
}

const expandHome = (p: string) => p.replace(/^~/, os.homedir());

export const plansDir = () =>
  process.env.AGENTOS_PLANS_DIR ||
  path.join(os.homedir(), ".agent-os", "plans");
export const planPathOf = (featureId: string) =>
  path.join(plansDir(), `${featureId}.md`);

function ref(id: string): ProjectRef | null {
  const p = db
    .prepare(`SELECT id, name, working_directory FROM projects WHERE id = ?`)
    .get(id) as
    | { id: string; name: string; working_directory: string }
    | undefined;
  if (!p) return null;
  const deploy = loadProjectConfig(expandHome(p.working_directory)).config
    .deploy;
  return { id: p.id, name: p.name, deploys: !!deploy?.deployed };
}

// A repo named in a plan resolves by project name, then by the repo's folder
// name, then by its GitHub owner/name (or just the name part), ignoring case.
// A folder or GitHub match must be a single project: two would be a guess.
export function resolveRepo<
  T extends { id: string; name: string; working_directory: string },
>(rows: T[], token: string): T | null {
  const want = token
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  if (!want) return null;
  const named = rows.filter((r) => r.name.toLowerCase() === want);
  if (named.length) return named.length === 1 ? named[0] : null;
  const folder = (r: T) =>
    path.basename(expandHome(r.working_directory)).toLowerCase();
  const byFolder = rows.filter((r) => folder(r) === want);
  if (byFolder.length) return byFolder.length === 1 ? byFolder[0] : null;
  const asSlug = slugOfRemote(`https://github.com/${want}`) ?? null;
  const bySlug = rows.filter((r) => {
    const slug = repoSlugSync(expandHome(r.working_directory));
    return slug && (slug === asSlug || slug.split("/")[1] === want);
  });
  return bySlug.length === 1 ? bySlug[0] : null;
}

export function checkContext(
  s: Pick<Session, "project_id">
): CheckContext | null {
  const own = s.project_id ? ref(s.project_id) : null;
  if (!own) return null;
  const rows = db
    .prepare(
      `SELECT id, name, working_directory FROM projects
       WHERE workspace_id = (SELECT workspace_id FROM projects WHERE id = ?)`
    )
    .all(own.id) as { id: string; name: string; working_directory: string }[];
  return {
    own,
    find: (name) => {
      const hit = resolveRepo(rows, name);
      return hit ? ref(hit.id) : null;
    },
  };
}

// The plan's pieces after the checker, with Saad's edits applied. Null when
// there's no plan file or no project: one piece, as always.
export function planFor(s: Session, text: string): PiecesResult | null {
  const ctx = checkContext(s);
  return ctx ? checkPieces(text, ctx) : null;
}

export function getFeature(id: string): Feature | undefined {
  return db.prepare(`SELECT * FROM features WHERE id = ?`).get(id) as
    | Feature
    | undefined;
}

export function piecesOf(featureId: string): FeaturePiece[] {
  return db
    .prepare(
      `SELECT * FROM feature_pieces WHERE feature_id = ? ORDER BY position`
    )
    .all(featureId) as FeaturePiece[];
}

export function pieceOfSession(sessionId: string): FeaturePiece | undefined {
  return db
    .prepare(
      `SELECT * FROM feature_pieces WHERE session_id = ? ORDER BY position`
    )
    .get(sessionId) as FeaturePiece | undefined;
}

// The PR a piece's task merged, when it is in the piece's own repository: a
// session's PR is always in its project's repo, so another project's merge is
// not this piece's work.
export function prOf(p: FeaturePiece): number | null {
  if (!p.session_id) return null;
  const s = db
    .prepare(`SELECT pr_number, project_id FROM sessions WHERE id = ?`)
    .get(p.session_id) as
    | { pr_number: number | null; project_id: string | null }
    | undefined;
  return s && s.project_id === p.project_id ? s.pr_number : null;
}

export function featureOfPlan(sessionId: string): Feature | undefined {
  return db
    .prepare(`SELECT * FROM features WHERE plan_session_id = ?`)
    .get(sessionId) as Feature | undefined;
}

export interface Split {
  pieces: Piece[];
  notBuilding: string[];
  listed: number;
  folded: Folded[];
  // Why the plan's pieces can't be registered; when set, nothing is built
  // on a guess.
  errors: string[];
  // Whether the plan needs a feature: false for one piece in the task's own
  // repository that only has edits to carry.
  feature: boolean;
}

// The pieces to build for a plan, or null when it is one piece in the task's
// own repository, as almost every plan is. A plan that lists more than it
// builds, or whose one piece belongs to another project, is not null: it
// gets a feature so nothing it listed goes missing. Edits Saad made on the
// plan view apply only here, at approval.
export function splitOf(s: Session, text: string): Split | null {
  const result = planFor(s, text);
  if (!result) return null;
  const { pieces, notBuilding } = applyEdits(result, parseEdits(s.plan_edits));
  const elsewhere = pieces.some((p) => p.project.id !== s.project_id);
  const feature = pieces.length > 1 || elsewhere || result.folded.length > 0;
  if (!feature && !notBuilding.length && !result.errors.length) return null;
  return {
    pieces,
    notBuilding,
    listed: result.listed,
    folded: result.folded,
    errors: result.errors,
    feature,
  };
}

// The piece the planning task builds itself: the first one in its own
// repository that doesn't wait on another. Every other piece starts as its own
// task in its own project.
export function ownPieceOf(
  pieces: Piece[],
  ownProjectId: string | null
): Piece | undefined {
  return pieces.find(
    (p) => p.project.id === ownProjectId && p.afterPosition === null
  );
}

// One transaction: the feature, its pieces, and the plan kept past the
// worktree. The planning task's own piece (if it has one) is already
// building; the rest wait to start as tasks of their own.
export function createFeature(
  s: Session,
  text: string,
  pieces: Piece[],
  workspaceId: string,
  meta: { listed: number; folded: Folded[] } = {
    listed: pieces.length,
    folded: [],
  }
): Feature {
  const own = ownPieceOf(pieces, s.project_id)?.position;
  const id = randomUUID();
  fs.mkdirSync(plansDir(), { recursive: true });
  fs.writeFileSync(planPathOf(id), text);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO features (id, workspace_id, name, plan_session_id, plan_text, status, listed, folded)
       VALUES (?, ?, ?, ?, ?, 'building', ?, ?)`
    ).run(
      id,
      workspaceId,
      s.name,
      s.id,
      text,
      meta.listed,
      meta.folded.length
        ? meta.folded.map((f) => `${f.name}: ${f.why}`).join("\n")
        : null
    );
    const insert = db.prepare(
      `INSERT INTO feature_pieces
         (feature_id, position, name, slice, project_id, after_position, after_kind,
          reasons, owns, status, session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const p of pieces)
      insert.run(
        id,
        p.position,
        p.name,
        p.slice,
        p.project.id,
        p.afterPosition,
        p.afterKind,
        p.reasons.join("+") || null,
        p.owns.join(", ") || null,
        p.position === own ? "building" : "waiting",
        p.position === own ? s.id : null
      );
  })();
  return getFeature(id)!;
}

const PLAN_IN_REVIEW = 20_000;

// What a piece's review judges the diff against: its slice, not the whole
// task. The last piece standing is also asked whether the plan is done.
export function reviewGoal(sessionId: string): string | null {
  const piece = pieceOfSession(sessionId);
  const feature = piece ? getFeature(piece.feature_id) : undefined;
  if (!piece || !feature) return null;
  const all = piecesOf(feature.id);
  const live = all.filter((p) => p.status !== "dropped");
  const owns = piece.owns ? `\nThis piece owns: ${piece.owns}.` : "";
  const head = `Piece ${piece.position} of ${live.length}, "${piece.name}": ${piece.slice}${owns}`;
  const last = live.every((p) => p.id === piece.id || p.status === "merged");
  const folded = feature.folded
    ? ` Pieces the plan listed that were built into others: ${feature.folded}.`
    : "";
  if (!last || (live.length < 2 && !feature.folded)) return head;
  return `${head}\n\nThis is the last piece.${folded} Also check that the plan as a whole is now done, and list anything in it that no piece built. The plan:\n${feature.plan_text.slice(0, PLAN_IN_REVIEW)}`;
}
