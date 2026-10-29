// What you can do with an artifact, decided by the server so every client
// (the web app, the native app) shows the same actions without hardcoding
// them. Pure and import-free so the native app can sync it.

export type ArtifactActionId =
  | "fullscreen"
  | "share"
  | "open"
  | "download"
  | "open-pr"
  | "copy-path"
  | "open-in-files";

export type DownloadFormat = "pdf" | "html" | "md";

export interface ArtifactAction {
  id: ArtifactActionId;
  label: string;
  // download: the formats this machine can make.
  formats?: DownloadFormat[];
}

// One version of a page, as the version switcher lists it.
export interface ArtifactVersion {
  id: string;
  version: number;
  title: string;
  note?: string;
  // ms
  createdAt: number;
  bytes?: number;
  // The message that asked for it: its place among the chat's messages
  // (1-based) and how it starts.
  turn?: { itemId: string; index: number; prompt: string };
}

export interface PageVersions {
  pageId: string;
  latestId: string;
  versions: ArtifactVersion[];
  actions: ArtifactAction[];
}

export function pageActions(ctx: { pdf: boolean }): ArtifactAction[] {
  return [
    { id: "fullscreen", label: "Full screen" },
    { id: "share", label: "Share" },
    { id: "open", label: "Open" },
    {
      id: "download",
      label: "Download",
      formats: ctx.pdf ? ["pdf", "html", "md"] : ["html", "md"],
    },
  ];
}

// The actions for anything in a session's Artifacts view.
export function artifactActions(
  a: {
    kind: string;
    state: string;
    path?: string;
    url?: string;
  },
  ctx: { pdf: boolean }
): ArtifactAction[] {
  if (a.kind === "page")
    return a.state === "live" || a.state === "kept" ? pageActions(ctx) : [];
  const out: ArtifactAction[] = [];
  if (a.url) out.push({ id: "open-pr", label: "Open PR" });
  if (a.path) out.push({ id: "copy-path", label: "Copy path" });
  if (a.path && a.state === "live" && (a.kind === "file" || a.kind === "plan"))
    out.push({ id: "open-in-files", label: "Open in Files" });
  return out;
}
