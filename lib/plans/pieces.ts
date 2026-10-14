/**
 * The `## Pieces` block a plan ends with, and the deterministic check that
 * decides how many pieces it really is. A plan is one piece unless it names
 * one of four reasons for splitting, and these rules (not a model) enforce
 * that: a piece without a standing reason is folded into the one before it.
 */

export const MAX_PIECES = 6;

export type PieceReason = "a" | "b" | "c" | "d";

export interface ProjectRef {
  id: string;
  name: string;
  // Whether the project's agentos.json names a `deploy.deployed` file.
  deploys: boolean;
}

export interface Piece {
  position: number;
  name: string;
  slice: string;
  project: ProjectRef;
  afterPosition: number | null;
  afterKind: "merged" | "deployed" | null;
  reasons: PieceReason[];
  owns: string[];
}

export interface Folded {
  name: string;
  into: number;
  why: string;
}

export interface PiecesResult {
  pieces: Piece[];
  folded: Folded[];
  warnings: string[];
  // Items the plan's Pieces block lists (0 when it has none), however well
  // they parsed: a plan that builds as fewer than it listed is never silent.
  listed: number;
  // Problems that must stop a task from building on a guess: the pieces
  // returned are then the one-piece fallback, for a person to approve or fix.
  errors: string[];
}

interface Raw {
  position: number;
  name: string;
  slice: string;
  repo: string | null;
  after: { position: number; kind: "merged" | "deployed" } | null;
  reasons: PieceReason[];
  owns: string[];
}

const HEADING = /^##\s+pieces\s*$/i;
const ITEM = /^\s{0,3}(\d+)[.)]\s+(.*\S)\s*$/;
// An item as a person might write it, to count what the plan listed even
// when the strict parser rejects the block.
const LOOSE_ITEM = /^\s{0,3}(?:[-*+]\s+)?\**\d+[.)]/;
const AFTER = /^\s*after:\s*(?:piece\s+)?(\d+)\s+is\s+(merged|deployed)\b.*$/i;
const WHY = /^\s*why split:\s*(.+?)\s*$/i;
const OWNS = /^\s*owns:\s*(.+?)\s*$/i;

function block(text: string): string[] | null {
  const lines = text.split("\n");
  let start = -1;
  lines.forEach((l, i) => {
    if (HEADING.test(l.trim())) start = i;
  });
  if (start < 0) return null;
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(l)) break;
    out.push(l);
  }
  return out;
}

// Bullets and bold around the numbers and keys a model sometimes adds
// ("- **after:** 1 is merged") don't change what a line says.
function plain(line: string): string {
  return line
    .replace(/^(\s*)[-*+]\s+(?=\**(?:\d+[.)]|after|why split|owns))/i, "$1")
    .replace(/\*\*|__/g, "");
}

function parseItem(position: number, rest: string): Raw {
  let repo: string | null = null;
  const withRepo = rest.match(/^(.*?)\s*\(repo:\s*([^)]+)\)\s*$/i);
  if (withRepo) {
    rest = withRepo[1];
    repo = withRepo[2].trim();
  }
  const split = rest.indexOf(":");
  const name = (split > 0 ? rest.slice(0, split) : rest).trim();
  const slice = (split > 0 ? rest.slice(split + 1) : rest).trim();
  return {
    position,
    name: name.slice(0, 80) || `Piece ${position}`,
    slice: slice || name,
    repo,
    after: null,
    reasons: [],
    owns: [],
  };
}

function parseBlock(lines: string[]): Raw[] | null {
  const items: Raw[] = [];
  for (const original of lines) {
    if (!original.trim()) continue;
    const line = plain(original);
    const item = line.match(ITEM);
    if (item) {
      items.push(parseItem(Number(item[1]), item[2]));
      continue;
    }
    const current = items[items.length - 1];
    if (!current) return null;
    const after = line.match(AFTER);
    const why = line.match(WHY);
    const owns = line.match(OWNS);
    if (after)
      current.after = {
        position: Number(after[1]),
        kind: after[2].toLowerCase() as "merged" | "deployed",
      };
    else if (why)
      current.reasons = [
        ...new Set(
          (why[1].toLowerCase().match(/\(([abcd])\)/g) ?? []).map(
            (m) => m[1] as PieceReason
          )
        ),
      ];
    else if (owns)
      current.owns = owns[1]
        .split(/[,;]/)
        .map((o) => o.trim().toLowerCase())
        .filter(Boolean);
    // A wrapped slice: an indented line that is none of the keys.
    else if (/^\s{2,}\S/.test(original)) current.slice += ` ${line.trim()}`;
    else return null;
  }
  if (!items.length || items.some((it, i) => it.position !== i + 1))
    return null;
  return items;
}

export interface CheckContext {
  // The project the plan's task works in: a piece naming none gets this.
  own: ProjectRef;
  find: (name: string) => ProjectRef | null;
}

function one(
  text: string,
  ctx: CheckContext,
  warnings: string[],
  listed = 0,
  errors: string[] = []
): PiecesResult {
  return {
    pieces: [
      {
        position: 1,
        name: "Plan",
        slice: text.trim().slice(0, 500),
        project: ctx.own,
        afterPosition: null,
        afterKind: null,
        reasons: [],
        owns: [],
      } satisfies Piece,
    ],
    folded: [] as Folded[],
    warnings,
    listed,
    errors,
  };
}

export function checkPieces(text: string, ctx: CheckContext): PiecesResult {
  const lines = block(text);
  if (!lines) return one("", ctx, []);
  const listed = lines.filter((l) => LOOSE_ITEM.test(l)).length;
  const raw = parseBlock(lines);
  if (!raw)
    return one("", ctx, [], listed, [
      "the Pieces block couldn't be read (a numbered item followed by anything but after:, why split: and owns: lines)",
    ]);
  if (raw.length !== listed)
    return one("", ctx, [], listed, [
      `the Pieces block lists ${listed} items but ${raw.length} were read`,
    ]);
  if (raw.length > MAX_PIECES)
    return one("", ctx, [], listed, [
      `${raw.length} pieces is past the limit of ${MAX_PIECES}`,
    ]);

  const warnings: string[] = [];
  const errors: string[] = [];
  const projects = raw.map((r) => {
    if (!r.repo) return ctx.own;
    const found = ctx.find(r.repo);
    if (!found)
      errors.push(
        `"${r.name}": (repo: ${r.repo}) is not a project of this workspace`
      );
    return found ?? ctx.own;
  });
  if (errors.length) return one("", ctx, [], listed, errors);

  // Where each original piece ended up, for `after:` lines that pointed at a
  // piece that was folded.
  const landed = new Map<number, number>();
  const pieces: Piece[] = [];
  const folded: Folded[] = [];

  raw.forEach((r, i) => {
    const project = projects[i];
    const fold = (why: string) => {
      const into = pieces[pieces.length - 1];
      into.slice = `${into.slice}\n${r.name}: ${r.slice}`;
      into.owns = [...new Set([...into.owns, ...r.owns])];
      landed.set(r.position, into.position);
      folded.push({ name: r.name, into: into.position, why });
    };
    const keep = (p: Omit<Piece, "position">) => {
      const position = pieces.length + 1;
      pieces.push({ ...p, position });
      landed.set(r.position, position);
    };

    if (i === 0) {
      keep({
        name: r.name,
        slice: r.slice,
        project,
        afterPosition: null,
        afterKind: null,
        reasons: [],
        owns: r.owns,
      });
      return;
    }

    let reasons = r.reasons;
    if (!reasons.length)
      return fold("no `why split:` line naming one of (a) to (d)");
    const lost: string[] = [];

    if (reasons.includes("a")) {
      const others = projects.filter((_, j) => j !== i);
      if (others.some((p) => p.id === project.id)) {
        reasons = reasons.filter((x) => x !== "a");
        lost.push("(a) shares a repo with another piece");
        warnings.push(
          `"${r.name}" claimed (a) but shares a repo with another piece.`
        );
      }
    }

    let afterPosition: number | null = null;
    let afterKind = r.after?.kind ?? null;
    if (r.after) {
      const target = landed.get(r.after.position);
      if (target === undefined || r.after.position >= r.position) {
        warnings.push(`"${r.name}": after: ${r.after.position} isn't earlier.`);
        afterKind = null;
      } else {
        afterPosition = target;
      }
    }

    if (reasons.includes("b")) {
      const dep = afterPosition ? pieces[afterPosition - 1] : null;
      if (afterKind !== "deployed" || !dep) {
        reasons = reasons.filter((x) => x !== "b");
        lost.push("(b) needs `after: N is deployed`, not merged");
      } else if (!dep.project.deploys) {
        reasons = reasons.filter((x) => x !== "b");
        lost.push(`(b) waits on a deploy ${dep.project.name} can't check`);
        afterKind = "merged";
        warnings.push(
          `"${r.name}" waits on a deploy that ${dep.project.name} can't check; it waits for the merge instead.`
        );
      }
    } else if (afterKind === "deployed") {
      const dep = afterPosition ? pieces[afterPosition - 1] : null;
      if (!dep?.project.deploys) afterKind = "merged";
    }

    if (!reasons.length)
      return fold(`its reason didn't hold: ${lost.join("; ")}`);

    keep({
      name: r.name,
      slice: r.slice,
      project,
      afterPosition,
      afterKind: afterPosition ? (afterKind ?? "merged") : null,
      reasons,
      owns: r.owns,
    });
  });

  const seen = new Map<string, number>();
  for (const p of pieces)
    for (const o of p.owns) {
      const first = seen.get(o);
      if (first !== undefined && first !== p.position)
        warnings.push(`"${o}" is owned by pieces ${first} and ${p.position}.`);
      else seen.set(o, p.position);
    }

  return { pieces, folded, warnings, listed, errors };
}

// What a task that builds fewer pieces than its plan listed is told, so the
// folded work is built here and not left for pieces that will never start.
export function foldedBrief(
  result: Pick<PiecesResult, "listed" | "folded">
): string {
  return `The plan listed ${result.listed} pieces; they're built as ONE here (${result.folded.map((f) => `${f.name}: ${f.why}`).join("; ")}). Build all of it in this PR, including the folded pieces: ${result.folded.map((f) => f.name).join(", ")}. Nothing else will build them.`;
}

export const PIECES_PROMPT = `At the end of the plan, add a \`## Pieces\` block. The default is exactly one piece, which is what almost every task is, and one piece needs no more than:

## Pieces
1. <name>: <one-line slice>  (repo: <project>)

Add another piece only when one of these holds, and say which on a \`why split:\` line:
(a) it spans repositories (a task works in one repo);
(b) one part must be live (merged and deployed) before the other can merge;
(c) one part needs the user mid-way (signing, a credential, a product call) and the rest doesn't;
(d) one part must be revertible on its own: a migration that rewrites or deletes existing rows, or an auth or security change bundled with unrelated work. An additive migration doesn't count.
Diff size is never a reason. A later piece looks like:
2. <name>: <one-line slice>  (repo: <project>)
   after: 1 is merged   (or: 1 is deployed)
   why split: (a) + (b)
   owns: migration 81
A shared resource (a migration id, a new table, a config key) goes on exactly one piece's \`owns:\` line. A piece with no valid reason is folded into the one before it. Reason (b) needs \`after: N is deployed\`; \`after: N is merged\` alone is only ordering, not a reason. A piece in another project runs as its own task in that project; this task builds only the pieces in its own repository.`;

// Shown to a piece's agent in place of the whole plan.
export function pieceBrief(
  total: number,
  piece: Pick<Piece, "position" | "name" | "slice" | "owns">,
  planPath: string,
  before: string[] = [],
  project?: string
): string {
  const owns = piece.owns.length
    ? `\nThis piece owns: ${piece.owns.join(", ")}. No other piece touches it.`
    : "";
  const earlier = before.length
    ? `\nPieces before you: ${before.join("; ")}.`
    : "";
  const where = project
    ? `\nWork only in this task's repository (${project}) and its worktree. Don't create worktrees, branches or PRs in another repository: AgentOS starts the pieces that belong there as their own tasks.`
    : "";
  return `Build piece ${piece.position} of ${total} only, "${piece.name}": ${piece.slice}${owns}${earlier}${where}\nThe rest of the plan is other pieces' work; don't start it. Full plan: ${planPath}`;
}

export interface PlanEdits {
  // Positions to fold into the piece before them, and to leave out.
  merge?: number[];
  drop?: number[];
}

export function parseEdits(raw: string | null | undefined): PlanEdits {
  try {
    const o = JSON.parse(raw ?? "{}") as PlanEdits;
    const ints = (v: unknown) =>
      Array.isArray(v) ? v.filter((n) => Number.isInteger(n)) : [];
    return { merge: ints(o.merge), drop: ints(o.drop) };
  } catch {
    return {};
  }
}

// Saad's edits to the pieces before approving: a merged piece joins the one
// before it, a dropped one is left out (and listed, so nothing vanishes).
// Piece 1 can't be dropped or merged.
export function applyEdits(
  result: PiecesResult,
  edits: PlanEdits
): { pieces: Piece[]; notBuilding: string[] } {
  const drop = new Set(edits.drop ?? []);
  const merge = new Set(edits.merge ?? []);
  const notBuilding: string[] = [];
  const kept: Piece[] = [];
  const landed = new Map<number, number>();
  for (const p of result.pieces) {
    const before = kept[kept.length - 1];
    if (p.position > 1 && drop.has(p.position)) {
      notBuilding.push(`${p.name}: ${p.slice}`);
      continue;
    }
    if (p.position > 1 && merge.has(p.position) && before) {
      before.slice = `${before.slice}\n${p.name}: ${p.slice}`;
      before.owns = [...new Set([...before.owns, ...p.owns])];
      landed.set(p.position, before.position);
      continue;
    }
    const position = kept.length + 1;
    landed.set(p.position, position);
    const after =
      p.afterPosition === null ? undefined : landed.get(p.afterPosition);
    kept.push({
      ...p,
      position,
      afterPosition: after && after < position ? after : null,
      afterKind: after && after < position ? p.afterKind : null,
    });
  }
  return { pieces: kept, notBuilding };
}
