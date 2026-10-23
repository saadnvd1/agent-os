import type { Claim } from "@/lib/claims/types";
import type { ClaimsView } from "@/lib/claims/view";

const span = (ms: number) => {
  const mins = Math.floor(Math.max(0, ms) / 60_000);
  if (mins < 1) return "under a minute";
  if (mins < 60) return `${mins}m`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / (24 * 60))}d`;
};

/** "started 12m ago". */
export const startedText = (c: Pick<Claim, "startedAt">, now: number) => {
  const s = span(now - c.startedAt);
  return s === "under a minute" ? "just started" : `started ${s} ago`;
};

/** "last heard 6m ago". */
export const lastHeardText = (at: number | null, now: number) => {
  if (at === null) return "serves this dashboard";
  const s = span(now - at);
  return s === "under a minute" ? "heard just now" : `last heard ${s} ago`;
};

/** A machine not heard from for this long is shown as quiet. */
export const QUIET_MS = 3 * 60_000;

export interface RepoGroup {
  repo: string;
  claims: Claim[];
}

/** Claims by repository, the repository with the oldest work first. */
export function groupByRepo(claims: Claim[]): RepoGroup[] {
  const byRepo = new Map<string, Claim[]>();
  for (const c of claims)
    byRepo.set(c.repo, [...(byRepo.get(c.repo) ?? []), c]);
  return [...byRepo]
    .map(([repo, list]) => ({
      repo,
      claims: [...list].sort((a, b) => a.startedAt - b.startedAt),
    }))
    .sort((a, b) => a.claims[0].startedAt - b.claims[0].startedAt);
}

/** The claims and overlaps of one pair, or everything when no pair is set. */
export function focusView(
  view: Pick<ClaimsView, "claims" | "overlaps">,
  focus: string[] | null
) {
  if (!focus) return view;
  const ids = new Set(focus);
  return {
    claims: view.claims.filter((c) => ids.has(c.id)),
    overlaps: view.overlaps.filter((o) => ids.has(o.a) && ids.has(o.b)),
  };
}
