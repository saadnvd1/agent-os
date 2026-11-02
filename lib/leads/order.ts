import { TECH } from "./types";

// Client-safe. A workspace's team in the order it's shown: the chief of
// staff, Tech, the shipped kinds, then custom ones by name.
export const CHIEF = "chief";

const ORDER = [CHIEF, TECH, "marketing", "product"];

export const leadRank = (kind: string): number => {
  const i = ORDER.indexOf(kind);
  return i < 0 ? ORDER.length : i;
};

export const byLeadOrder = (a: string, b: string) =>
  leadRank(a) - leadRank(b) || a.localeCompare(b);

// What a member's avatar says: C, T, M, P, or a custom kind's first letter.
export const memberLetter = (kind: string): string =>
  kind === CHIEF ? "C" : (kind[0] ?? "?").toUpperCase();

// A custom lead's kind from the name typed for it ("Design lead" -> design),
// or null when nothing usable is left.
export function kindFromName(name: string): string | null {
  const kind = name
    .toLowerCase()
    .replace(/\blead\s*$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");
  return kind && kind !== CHIEF ? kind : null;
}
