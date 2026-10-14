import type {
  ArtifactKind,
  SessionArtifact,
} from "@/lib/session-artifacts/types";

export type ArtifactFilter = "all" | "files" | "pages" | "images" | "logs";

const FILTER_KINDS: Record<Exclude<ArtifactFilter, "all">, ArtifactKind[]> = {
  files: ["file"],
  pages: ["page"],
  images: ["image"],
  logs: ["log"],
};

export const FILTER_LABELS: Record<ArtifactFilter, string> = {
  all: "All",
  files: "Files",
  pages: "Pages",
  images: "Images",
  logs: "Logs",
};

const GROUPS: { label: string; kinds: ArtifactKind[] }[] = [
  { label: "Plan & PR", kinds: ["plan", "pr", "run", "session-log"] },
  { label: "Pages", kinds: ["page"] },
  { label: "Files", kinds: ["file"] },
  { label: "Images", kinds: ["image"] },
  { label: "Logs", kinds: ["log"] },
];

export const isGone = (a: SessionArtifact) =>
  a.state === "gone" || a.state === "in-pr";

export function visible(
  all: SessionArtifact[],
  filter: ArtifactFilter,
  showGone: boolean
): SessionArtifact[] {
  return all.filter(
    (a) =>
      (showGone || !isGone(a)) &&
      (filter === "all" || FILTER_KINDS[filter].includes(a.kind))
  );
}

export function groups(list: SessionArtifact[]) {
  return GROUPS.map((g) => ({
    label: g.label,
    items: list.filter((a) => g.kinds.includes(a.kind)),
  })).filter((g) => g.items.length);
}

// How many of each filter there are, among what's shown.
export function counts(all: SessionArtifact[], showGone: boolean) {
  const shown = visible(all, "all", showGone);
  return Object.fromEntries(
    (Object.keys(FILTER_LABELS) as ArtifactFilter[]).map((f) => [
      f,
      visible(shown, f, true).length,
    ])
  ) as Record<ArtifactFilter, number>;
}

// The PR's number, for "in PR #n".
export const prNumber = (all: SessionArtifact[]) =>
  all.find((a) => a.kind === "pr")?.name.match(/#(\d+)/)?.[1] ?? null;

export function stateLabel(a: SessionArtifact, pr: string | null) {
  switch (a.state) {
    case "kept":
      return "kept copy";
    case "in-pr":
      return pr ? `in PR #${pr}` : "committed";
    case "gone":
      return "gone";
    case "outside":
      return "outside";
    default:
      return null;
  }
}

// The folder a file is in, for the line under its name.
export const folderOf = (p: string) => {
  const i = p.lastIndexOf("/");
  return i > 0 ? p.slice(0, i + 1) : p;
};

// The next row for the arrow keys, wrapping at neither end.
export function step(
  list: SessionArtifact[],
  current: string | null,
  by: 1 | -1
): string | null {
  if (!list.length) return null;
  const i = list.findIndex((a) => a.id === current);
  if (i === -1) return list[0].id;
  return list[Math.min(list.length - 1, Math.max(0, i + by))].id;
}
