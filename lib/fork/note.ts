/** The one line the parent's chat keeps where forks were started. */

export const FORK_NOTE_PREFIX = "fork-";

export const startedText = (ns: number[], labels: string[]): string =>
  `${ns.length === 1 ? `Fork ${ns[0]}` : `Forks ${ns.join(", ")}`} started · ${labels.join(" · ")}`;
