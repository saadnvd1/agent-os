// The claims as text for the orchestrator and `aos claims`. A goal and a
// session name are another machine's words: fenced as data.

import { untrusted } from "../orchestrator/untrusted";
import { machineId } from "./machine";
import { findOverlaps } from "./overlap";
import type { Claim } from "./types";

const ago = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m < 1 ? "just now" : m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
};

export function describeClaims(
  claims: Claim[],
  opts: { onlyOthers?: boolean; now?: number } = {}
): string {
  const now = opts.now ?? Date.now();
  const self = machineId();
  const shown = opts.onlyOthers
    ? claims.filter((c) => c.origin !== self)
    : claims;
  if (!shown.length) return "";
  const lines = shown.map((c) => {
    const where = c.origin === self ? "here" : `on ${c.originName}`;
    const files = c.files.length + c.filesMore;
    return `- ${untrusted("claim", c.goal)} ${where}, ${c.branch ?? "no branch"}, ${files} file${files === 1 ? "" : "s"}, started ${ago(now - c.startedAt)} ago${c.prUrl ? `, ${c.prUrl}` : ""}`;
  });
  const overlaps = findOverlaps(claims).filter(
    (o) => !opts.onlyOthers || o.a.origin !== self || o.b.origin !== self
  );
  const tail = overlaps.map(
    (o) =>
      `! ${o.strength} overlap (${o.kinds.join("+")}): ${untrusted("claim", o.a.goal)} (${o.a.originName}) and ${untrusted("claim", o.b.goal)} (${o.b.originName})${o.shared.length ? `, shared ${o.shared.slice(0, 5).join(", ")}` : ""}`
  );
  return [
    "Claimed work (live sessions on linked machines):",
    ...lines,
    ...tail,
  ].join("\n");
}
