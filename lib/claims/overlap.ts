// Whether two live claims are working on the same thing. Pure: the same two
// claims give the same answer on every machine, which the yield rule needs.

import { goalsAlike } from "./goal";
import type { Claim, Overlap } from "./types";

const NOISE =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Gemfile\.lock|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock|composer\.lock|CHANGELOG[^/]*|__snapshots__\/.*|migrations\.generated\.ts)$/i;

export const isNoise = (path: string) =>
  NOISE.test(path) || /(^|\/)__snapshots__\//.test(path);

// A path this many claims touch is a shared index or router, not a signal.
export const HUB_CLAIMS = 4;

const isBase = (b: string | null, c: Claim, o: Claim) =>
  !b ||
  b === "HEAD" ||
  b === "main" ||
  b === "master" ||
  b === c.base ||
  b === o.base;

function sameWork(a: Claim, b: Claim): boolean {
  if (a.id === b.id) return true;
  if (a.sessionId && a.sessionId === b.sessionId && a.origin === b.origin)
    return true;
  return !!a.branch && a.origin === b.origin && a.branch === b.branch;
}

export function overlapBetween(
  a: Claim,
  b: Claim,
  hubs: ReadonlySet<string> = new Set()
): Overlap | null {
  if (a.repo !== b.repo || sameWork(a, b)) return null;
  const kinds: Overlap["kinds"] = [];
  let strong = false;

  if (a.branch && a.branch === b.branch && !isBase(a.branch, a, b)) {
    kinds.push("branch");
    strong = true;
  }

  const fa = new Set(a.files.filter((f) => !isNoise(f)));
  const fb = new Set(b.files.filter((f) => !isNoise(f)));
  let shared = [...fa].filter((f) => fb.has(f));
  if (shared.length && shared.every((f) => hubs.has(f))) shared = [];
  const smaller = Math.min(fa.size, fb.size);
  const ratio = smaller ? shared.length / smaller : 0;
  const alike = goalsAlike(a.goal, b.goal);
  if (shared.length && (shared.length >= 2 || ratio >= 0.3)) {
    kinds.push("files");
    if (shared.length >= 3 || ratio >= 0.5 || alike) strong = true;
  }
  if (alike) kinds.push("goal");
  if (!kinds.length) return null;
  return {
    a,
    b,
    kinds,
    shared: shared.sort(),
    strength: strong ? "strong" : "weak",
  };
}

export function findOverlaps(claims: Claim[]): Overlap[] {
  const live = claims.filter((c) => !c.released);
  const byRepo = new Map<string, Claim[]>();
  for (const c of live) byRepo.set(c.repo, [...(byRepo.get(c.repo) ?? []), c]);
  const out: Overlap[] = [];
  for (const group of byRepo.values()) {
    const touched = new Map<string, number>();
    for (const c of group)
      for (const f of new Set(c.files))
        touched.set(f, (touched.get(f) ?? 0) + 1);
    const hubs = new Set(
      [...touched].filter(([, n]) => n >= HUB_CLAIMS).map(([f]) => f)
    );
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const o = overlapBetween(group[i], group[j], hubs);
        if (o) out.push(o);
      }
  }
  return out;
}
