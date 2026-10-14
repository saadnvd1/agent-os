/**
 * A session's artifacts from what AgentOS already stored about it: its chat
 * items, PR, recipe run and log. No IO here; collect.ts reads the rows and
 * the files, this decides what they are.
 */

import { createHash } from "crypto";
import os from "os";
import path from "path";
import { isSecretPath } from "../secret-paths";
import type {
  ArtifactKind,
  ArtifactPreview,
  ArtifactState,
  SessionArtifact,
} from "./types";

// A chat item as collect.ts selects it: only the fields that matter, never
// a tool's output or a Write's content.
export interface ItemRow {
  item_id: string;
  kind: string;
  at: number | null;
  name?: string | null;
  status?: string | null;
  file_path?: string | null;
  notebook_path?: string | null;
  input_path?: string | null;
  file_path_camel?: string | null;
  changes?: string | null;
  artifact_id?: string | null;
  title?: string | null;
  task_id?: string | null;
  output_file?: string | null;
  task_type?: string | null;
  subagent_type?: string | null;
  description?: string | null;
  ambient?: number | null;
  image_count?: number | null;
}

export type Source =
  | { type: "file"; path: string }
  | { type: "page"; artifactId: string }
  | { type: "attached"; itemId: string; index: number }
  | { type: "log"; taskId: string; path?: string }
  | { type: "plan"; path?: string; chatItemId?: string }
  | { type: "pr" }
  | { type: "run"; runId: number }
  | { type: "session-log" };

// Before collect.ts has looked at the disk.
export interface Candidate {
  key: string;
  kind: ArtifactKind;
  name: string;
  at: number;
  edits?: number;
  by?: "you" | "shell";
  detail?: string;
  url?: string;
  source: Source;
}

export interface Entry {
  artifact: SessionArtifact;
  source: Source;
  // The file to serve: the live one, or its kept copy. Never sent out.
  read?: string;
}

// Tools that write the file they're given.
const EDIT_TOOLS = new Set([
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "write",
  "edit",
]);
// Other tools whose file argument is something they made (a screenshot).
const MAKES_FILE = /screenshot|capture|snapshot|save|export|download|render/i;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const MARKDOWN_EXT = /\.(md|markdown|mdx)$/i;
const HTML_EXT = /\.html?$/i;

export const artifactId = (key: string) =>
  createHash("sha1").update(key).digest("hex").slice(0, 16);

export function previewFor(file: string): ArtifactPreview {
  if (IMAGE_EXT.test(file)) return "image";
  if (MARKDOWN_EXT.test(file)) return "markdown";
  if (HTML_EXT.test(file)) return "html";
  return "text";
}

export const kindForPath = (file: string): ArtifactKind =>
  IMAGE_EXT.test(file) ? "image" : "file";

// Absolute, with ~ and relative paths resolved against the session's folder.
export function resolvePath(
  p: string,
  cwd: string | null,
  home = os.homedir()
): string | null {
  const s = p.trim();
  if (!s || s.includes("\0")) return null;
  const expanded = s === "~" || s.startsWith("~/") ? home + s.slice(1) : s;
  if (path.isAbsolute(expanded)) return path.normalize(expanded);
  return cwd ? path.resolve(cwd, expanded) : null;
}

export const tildePath = (p: string, home = os.homedir()) =>
  p === home || p.startsWith(home + path.sep) ? "~" + p.slice(home.length) : p;

function changedPaths(changes: string | null | undefined): string[] {
  if (!changes) return [];
  try {
    const list = JSON.parse(changes);
    return Array.isArray(list)
      ? list.filter((p): p is string => typeof p === "string")
      : [];
  } catch {
    return [];
  }
}

// The files a tool call wrote, by its name and input.
export function toolPaths(row: ItemRow): string[] {
  const name = row.name ?? "";
  if (EDIT_TOOLS.has(name))
    return [
      row.file_path,
      row.notebook_path,
      row.input_path,
      row.file_path_camel,
      ...changedPaths(row.changes),
    ].filter((p): p is string => !!p);
  if (MAKES_FILE.test(name))
    return [row.file_path, row.file_path_camel, row.input_path].filter(
      (p): p is string => !!p && IMAGE_EXT.test(p)
    );
  return [];
}

// Every artifact the chat items name, grouped: one row per file however
// many times it was edited.
export function fromItems(
  rows: ItemRow[],
  cwd: string | null,
  home = os.homedir()
): Candidate[] {
  const out = new Map<string, Candidate>();
  let chatPlan: Candidate | null = null;
  for (const row of rows) {
    const at = row.at ?? 0;
    if (row.kind === "tool") {
      if (row.status === "error") continue;
      for (const raw of toolPaths(row)) {
        const file = resolvePath(raw, cwd, home);
        if (!file || isSecretPath(file)) continue;
        const key = `file:${file}`;
        const hit = out.get(key);
        const edit = EDIT_TOOLS.has(row.name ?? "") ? 1 : 0;
        if (hit) {
          hit.at = Math.max(hit.at, at);
          hit.edits = (hit.edits ?? 0) + edit;
        } else
          out.set(key, {
            key,
            kind: kindForPath(file),
            name: path.basename(file),
            at,
            edits: edit || undefined,
            source: { type: "file", path: file },
          });
      }
    } else if (row.kind === "artifact" && row.artifact_id) {
      const key = `page:${row.artifact_id}`;
      out.set(key, {
        key,
        kind: "page",
        name: row.title || "Untitled page",
        at,
        detail: "rendered page",
        source: { type: "page", artifactId: row.artifact_id },
      });
    } else if (row.kind === "task" && row.task_id) {
      // A subagent's output file is its whole transcript, not a log.
      if (row.ambient || row.subagent_type) continue;
      if (row.task_type !== "local_bash") continue;
      const key = `log:${row.task_id}`;
      out.set(key, {
        key,
        kind: "log",
        name: row.description || "Background job",
        at,
        detail: `background job · ${row.status ?? "running"}`,
        source: {
          type: "log",
          taskId: row.task_id,
          path: row.output_file ?? undefined,
        },
      });
    } else if (row.kind === "user" && row.image_count) {
      for (let i = 0; i < row.image_count; i++) {
        const key = `attached:${row.item_id}:${i}`;
        out.set(key, {
          key,
          kind: "image",
          name:
            row.image_count > 1 ? `Attached image ${i + 1}` : "Attached image",
          at,
          by: "you",
          source: { type: "attached", itemId: row.item_id, index: i },
        });
      }
    } else if (row.kind === "plan") {
      chatPlan = {
        key: "plan",
        kind: "plan",
        name: "Plan",
        at,
        source: { type: "plan", chatItemId: row.item_id },
      };
    }
  }
  if (chatPlan) out.set("plan", chatPlan);
  return [...out.values()];
}

// Paths from `git status --porcelain -z` in the worktree: what a shell
// command made or changed there. Deleted files aren't artifacts.
export function parsePorcelain(out: string, max = 300): string[] {
  const parts = out.split("\0");
  const files: string[] = [];
  for (let i = 0; i < parts.length && files.length < max; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    // A rename's old path follows as its own field.
    if (xy[0] === "R" || xy[0] === "C") i++;
    if (xy.includes("D")) continue;
    const rel = entry.slice(3);
    if (rel.endsWith("/")) continue;
    files.push(rel);
  }
  return files;
}

export function fromStatus(
  rels: string[],
  worktree: string,
  at: number,
  known: Set<string>
): Candidate[] {
  const out: Candidate[] = [];
  for (const rel of rels) {
    const file = path.resolve(worktree, rel);
    const key = `file:${file}`;
    if (known.has(key) || isSecretPath(file)) continue;
    out.push({
      key,
      kind: kindForPath(file),
      name: path.basename(file),
      at,
      by: "shell",
      source: { type: "file", path: file },
    });
  }
  return out;
}

// The plan: the worktree's plan file when there is one (its row replaces
// the file's), else the plan the chat proposed.
export function mergePlan(
  candidates: Candidate[],
  planFile: string | null
): Candidate[] {
  if (!planFile) return candidates;
  const fileKey = `file:${planFile}`;
  const asFile = candidates.find((c) => c.key === fileKey);
  const chat = candidates.find((c) => c.key === "plan");
  const plan: Candidate = {
    key: "plan",
    kind: "plan",
    name: "Plan",
    at: Math.max(asFile?.at ?? 0, chat?.at ?? 0),
    edits: asFile?.edits,
    source: {
      type: "plan",
      path: planFile,
      chatItemId:
        chat?.source.type === "plan" ? chat.source.chatItemId : undefined,
    },
  };
  return [
    plan,
    ...candidates.filter((c) => c.key !== fileKey && c.key !== "plan"),
  ];
}

export interface PrInfo {
  pr_url: string | null;
  pr_number: number | null;
  pr_status: string | null;
  at: number;
}

export function fromPr(pr: PrInfo): Candidate | null {
  if (!pr.pr_url && !pr.pr_number) return null;
  return {
    key: "pr",
    kind: "pr",
    name: pr.pr_number ? `PR #${pr.pr_number}` : "Pull request",
    at: pr.at,
    detail: pr.pr_status ?? "open",
    url: pr.pr_url ?? undefined,
    source: { type: "pr" },
  };
}

export interface RunRow {
  id: number;
  recipe_name: string | null;
  status: string;
  at: number;
}

export const fromRun = (run: RunRow): Candidate => ({
  key: `run:${run.id}`,
  kind: "run",
  name: run.recipe_name ? `Recipe run: ${run.recipe_name}` : "Recipe run",
  at: run.at,
  detail: run.status,
  source: { type: "run", runId: run.id },
});

export const fromSessionLog = (at: number): Candidate => ({
  key: "session-log",
  kind: "session-log",
  name: "Session log",
  at,
  source: { type: "session-log" },
});

// What collect.ts found on disk for a file-backed candidate.
export interface FileFacts {
  // Its size when it's there and a regular file.
  size?: number;
  // Inside the roots the app serves (lib/session-artifacts/access).
  allowed: boolean;
  // The kept copy, when the worktree went and one was made.
  keptSize?: number;
  // Committed when its worktree went (the kept manifest says so).
  committed?: boolean;
}

export function stateOf(facts: FileFacts): {
  state: ArtifactState;
  size?: number;
} {
  if (facts.size !== undefined)
    return facts.allowed
      ? { state: "live", size: facts.size }
      : { state: "outside", size: facts.size };
  if (facts.keptSize !== undefined)
    return { state: "kept", size: facts.keptSize };
  if (facts.committed) return { state: "in-pr" };
  return { state: "gone" };
}

export function toArtifact(
  c: Candidate,
  file: {
    state: ArtifactState;
    size?: number;
    path?: string;
    read?: string;
  } | null,
  home = os.homedir()
): Entry {
  const filePath = file?.path;
  const preview: ArtifactPreview =
    c.kind === "page"
      ? "html"
      : c.kind === "log"
        ? "text"
        : c.kind === "plan" || c.kind === "run" || c.kind === "session-log"
          ? "markdown"
          : c.kind === "pr"
            ? "markdown"
            : c.source.type === "attached"
              ? "image"
              : filePath
                ? previewFor(filePath)
                : "none";
  return {
    source: c.source,
    ...(file?.read && { read: file.read }),
    artifact: {
      id: artifactId(c.key),
      kind: c.kind,
      name: c.name,
      ...(filePath && { path: tildePath(filePath, home) }),
      at: c.at,
      ...(file?.size !== undefined && { size: file.size }),
      ...(c.edits && { edits: c.edits }),
      state: file?.state ?? "live",
      preview,
      ...(c.by && { by: c.by }),
      ...(c.detail && { detail: c.detail }),
      ...(c.url && { url: c.url }),
    },
  };
}

const ORDER: ArtifactKind[] = [
  "plan",
  "pr",
  "run",
  "session-log",
  "page",
  "file",
  "image",
  "log",
];

// Grouped by kind, newest first within one.
export function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort(
    (a, b) =>
      ORDER.indexOf(a.artifact.kind) - ORDER.indexOf(b.artifact.kind) ||
      b.artifact.at - a.artifact.at
  );
}
