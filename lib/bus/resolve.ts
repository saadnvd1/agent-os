// Which session a name someone typed means. Current names win, then names a
// session had before a rename, then a unique id prefix. More than one match
// at any step refuses and lists them; it never picks one.

import { matchesRef } from "./format";

export interface Candidate {
  id: string;
  name: string;
  projectName: string | null;
  tmuxName: string;
  // Newest first.
  previousNames: string[];
}

export type Resolution =
  | { ok: true; id: string; note?: string }
  | { ok: false; reason: "none" | "ambiguous"; error: string };

export const MIN_ID_PREFIX = 4;

const label = (c: Candidate) =>
  `${c.projectName ? `${c.projectName}/` : ""}${c.name} (id ${c.id.slice(0, 8)})`;

function ambiguous(ref: string, matches: Candidate[]): Resolution {
  return {
    ok: false,
    reason: "ambiguous",
    error: `"${ref}" matches ${matches.length} sessions: ${matches.map(label).join(", ")}. Use project/name or the id`,
  };
}

const matchesOld = (r: string, c: Candidate) =>
  c.previousNames.some((old) =>
    matchesRef(r, { ...c, id: "", tmuxName: "", name: old })
  );

export function resolveRef(ref: string, candidates: Candidate[]): Resolution {
  const r = ref.trim().toLowerCase();
  if (!r)
    return { ok: false, reason: "none", error: "Say which session to reach" };

  const current = candidates.filter((c) => matchesRef(r, c));
  if (current.length > 1) return ambiguous(ref, current);
  if (current.length === 1) {
    const [c] = current;
    const renamed = candidates.find((o) => o.id !== c.id && matchesOld(r, o));
    return {
      ok: true,
      id: c.id,
      note: renamed
        ? `"${ref}" is ${label(c)} now; the session that used to be called that is "${renamed.name}"`
        : undefined,
    };
  }

  const old = candidates.filter((c) => matchesOld(r, c));
  if (old.length > 1) return ambiguous(ref, old);
  if (old.length === 1)
    return {
      ok: true,
      id: old[0].id,
      note: `"${ref}" was renamed to "${old[0].name}"`,
    };

  if (r.length >= MIN_ID_PREFIX) {
    const prefixed = candidates.filter((c) => c.id.startsWith(r));
    if (prefixed.length > 1) return ambiguous(ref, prefixed);
    if (prefixed.length === 1) return { ok: true, id: prefixed[0].id };
  }

  return { ok: false, reason: "none", error: `No session called "${ref}"` };
}

// "orchestrator (was planner, Session 3)": its old names, newest first,
// without the one it has now.
export function wasNames(c: {
  name: string;
  previousNames: string[];
}): string[] {
  const now = c.name.toLowerCase();
  return c.previousNames.filter((n) => n.toLowerCase() !== now);
}
