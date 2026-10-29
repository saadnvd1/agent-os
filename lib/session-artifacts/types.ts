// What a session produced, as the Artifacts view lists it. Client-safe.

import type { ArtifactAction } from "../artifacts/actions";

export type ArtifactKind =
  "plan" | "file" | "page" | "image" | "log" | "pr" | "run" | "session-log";

// live: there to open. kept: its worktree went, a copy was kept. in-pr:
// committed, so the PR has it. gone: nothing left to open. outside: there,
// but outside what the app serves.
export type ArtifactState = "live" | "kept" | "in-pr" | "gone" | "outside";

export type ArtifactPreview = "markdown" | "html" | "image" | "text" | "none";

export interface SessionArtifact {
  id: string;
  kind: ArtifactKind;
  name: string;
  // Where it is, ~ for home; files, images, logs and plan files only.
  path?: string;
  // When it last changed in the chat (ms).
  at: number;
  size?: number;
  edits?: number;
  state: ArtifactState;
  preview: ArtifactPreview;
  // You attached it, or a shell command (not an edit tool) made it.
  by?: "you" | "shell";
  // A short line under the name: a PR's status, a job's state.
  detail?: string;
  // Its folder inside the worktree, "" at the top.
  folder?: string;
  // A link out (the PR on GitHub).
  url?: string;
  // A page: its latest version's artifact id, which version that is, and
  // how many there are.
  artifactId?: string;
  version?: number;
  versionCount?: number;
  // What the viewer can do with it; set by the server.
  actions?: ArtifactAction[];
}

export const openable = (a: Pick<SessionArtifact, "state" | "preview">) =>
  (a.state === "live" || a.state === "kept") && a.preview !== "none";
