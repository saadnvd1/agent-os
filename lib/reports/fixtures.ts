import type { EvidenceRef } from "./types";

export const HEAD = "abc1234";

export const ev = (
  id: string,
  kind: EvidenceRef["kind"],
  status: EvidenceRef["status"],
  extra: Partial<EvidenceRef> = {}
): EvidenceRef => ({
  id,
  kind,
  label: extra.label ?? id,
  status,
  at: "2026-10-21T12:00:00.000Z",
  ...extra,
});
