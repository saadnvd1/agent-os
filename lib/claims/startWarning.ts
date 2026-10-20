// An overlap of a new start with a live claim, as the start sheet shows it.

import type { Overlap } from "./types";

export interface StartWarning {
  strength: Overlap["strength"];
  kinds: Overlap["kinds"];
  shared: string[];
  claim: {
    id: string;
    goal: string;
    machine: string;
    branch: string | null;
    sessionName: string | null;
  };
}

export const startWarning = (o: Overlap): StartWarning => ({
  strength: o.strength,
  kinds: o.kinds,
  shared: o.shared.slice(0, 20),
  claim: {
    id: o.b.id,
    goal: o.b.goal,
    machine: o.b.originName,
    branch: o.b.branch,
    sessionName: o.b.sessionName,
  },
});
