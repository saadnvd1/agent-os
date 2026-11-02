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
