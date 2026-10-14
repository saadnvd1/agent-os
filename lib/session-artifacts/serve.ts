/**
 * What opening an artifact returns. Every file is checked again here (real
 * path, roots, secrets, size), whatever the list said; HTML is served as
 * agent output in the same sandbox as a rendered page.
 */

import fs from "fs";
import os from "os";
import { db, type Session } from "../db";
import { getItem } from "../chat/store";
import { findOutputFile } from "../chat/task-output";
import {
  getArtifact,
  readArtifactHtml,
  MAX_HTML_BYTES,
} from "../artifacts/store";
import { MAX_IMAGE_BYTES } from "../artifacts/images";
import { IMAGE_TYPES } from "../artifacts/image-paths";
import {
  ARTIFACT_HEADERS,
  IMAGE_CSP,
  prepareArtifact,
} from "../artifacts/serve";
import { demoMode } from "../security/demo";
import { run } from "../tasks/gh";
import { repoOfPR } from "../tasks/pr-activity";
import { resolveAllowed } from "./access";
import { previewFor, type Entry } from "./derive";
import { rootsOf } from "./collect";

export const MAX_TEXT_BYTES = 256 * 1024;
export const LOG_TAIL_BYTES = 64 * 1024;

export type Content =
  | {
      ok: true;
      body: Uint8Array<ArrayBuffer> | string;
      headers: Record<string, string>;
    }
  | { ok: false; status: number; error: string };

const TEXT_CSP = "default-src 'none'; sandbox";

const textHeaders = (type: string, truncated = false) => ({
  "Content-Type": `${type}; charset=utf-8`,
  "Content-Security-Policy": TEXT_CSP,
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, no-cache",
  ...(truncated && { "X-Artifact-Truncated": "1" }),
});

const imageHeaders = (type: string) => ({
  "Content-Type": type,
  "Content-Security-Policy": IMAGE_CSP,
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, no-cache",
});

const IMAGE_MEDIA = new Set(Object.values(IMAGE_TYPES));
const fail = (status: number, error: string): Content => ({
  ok: false,
  status,
  error,
});
const markdown = (text: string): Content => ({
  ok: true,
  body: text,
  headers: textHeaders("text/markdown"),
});

// Bytes from a file: its head, or its tail for a log.
function readSlice(file: string, size: number, max: number, tail: boolean) {
  const len = Math.min(size, max);
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(file, "r");
  try {
    fs.readSync(fd, buf, 0, len, tail ? size - len : 0);
  } finally {
    fs.closeSync(fd);
  }
  return buf;
}

const binary = (buf: Buffer) => buf.subarray(0, 8000).includes(0);

function serveFile(file: string, roots: string[], asLog = false): Content {
  const hit = resolveAllowed(file, roots);
  if (!hit.ok)
    return fail(hit.status, hit.status === 403 ? "Not served" : "Not found");
  const kind = asLog ? "text" : previewFor(hit.real);
  if (kind === "image") {
    const ext = hit.real.split(".").pop()!.toLowerCase();
    if (hit.size > MAX_IMAGE_BYTES) return fail(413, "Too large");
    return {
      ok: true,
      body: new Uint8Array(fs.readFileSync(hit.real)),
      headers: imageHeaders(IMAGE_TYPES[ext]),
    };
  }
  if (kind === "html") {
    if (hit.size > MAX_HTML_BYTES) return fail(413, "Too large");
    return {
      ok: true,
      body: prepareArtifact(fs.readFileSync(hit.real, "utf8")),
      headers: ARTIFACT_HEADERS,
    };
  }
  const max = asLog ? LOG_TAIL_BYTES : MAX_TEXT_BYTES;
  const buf = readSlice(hit.real, hit.size, max, asLog);
  if (binary(buf)) return fail(415, "Not a text file");
  let text = buf.toString("utf8");
  // A tail starts mid-line; drop the partial one.
  if (asLog && hit.size > max) text = text.slice(text.indexOf("\n") + 1);
  return {
    ok: true,
    body: text,
    headers: textHeaders(
      kind === "markdown" ? "text/markdown" : "text/plain",
      hit.size > max
    ),
  };
}

interface Commit {
  oid?: string;
  messageHeadline?: string;
}

async function prMarkdown(session: Session): Promise<string> {
  const lines = [
    `# ${session.pr_number ? `PR #${session.pr_number}` : "Pull request"}`,
    "",
    `Status: **${session.pr_status ?? "open"}**`,
  ];
  if (session.pr_url) lines.push("", session.pr_url);
  const repo = session.pr_url ? repoOfPR(session.pr_url) : null;
  if (!repo || !session.pr_number || demoMode()) return lines.join("\n");
  try {
    const out = await run(
      "gh",
      [
        "pr",
        "view",
        String(session.pr_number),
        "--repo",
        `${repo.owner}/${repo.name}`,
        "--json",
        "commits",
      ],
      os.tmpdir(),
      15_000
    );
    const commits = (JSON.parse(out).commits ?? []) as Commit[];
    lines.push("", `## Commits (${commits.length})`, "");
    for (const c of commits)
      lines.push(
        `- \`${String(c.oid ?? "").slice(0, 7)}\` ${String(c.messageHeadline ?? "").replace(/\n/g, " ")}`
      );
  } catch {
    lines.push("", "_Couldn't load its commits from GitHub._");
  }
  return lines.join("\n");
}

function runMarkdown(runId: number, sessionId: string): string | null {
  const row = db
    .prepare(
      `SELECT r.status, r.summary, r.outputs, r.error, r.duration_ms, r.pr_url,
              x.name AS recipe_name
         FROM recipe_runs r LEFT JOIN recipes x ON x.id = r.recipe_id
        WHERE r.id = ? AND r.session_id = ?`
    )
    .get(runId, sessionId) as
    | {
        status: string;
        summary: string | null;
        outputs: string | null;
        error: string | null;
        duration_ms: number | null;
        pr_url: string | null;
        recipe_name: string | null;
      }
    | undefined;
  if (!row) return null;
  const lines = [
    `# ${row.recipe_name ? `Recipe run: ${row.recipe_name}` : "Recipe run"}`,
    "",
    `Status: **${row.status}**${row.duration_ms ? ` · ${Math.round(row.duration_ms / 1000)}s` : ""}`,
  ];
  if (row.pr_url) lines.push("", row.pr_url);
  if (row.summary) lines.push("", "## Summary", "", row.summary);
  if (row.outputs) {
    let pretty = row.outputs;
    try {
      pretty = JSON.stringify(JSON.parse(row.outputs), null, 2);
    } catch {
      // Shown as stored.
    }
    lines.push("", "## Outputs", "", "```json", pretty, "```");
  }
  if (row.error) lines.push("", "## Error", "", row.error);
  return lines.join("\n");
}

export async function artifactContent(
  session: Session,
  entry: Entry
): Promise<Content> {
  const roots = rootsOf(session);
  const { source } = entry;
  const state = entry.artifact.state;
  if (state === "outside") return fail(403, "Outside what AgentOS serves");
  switch (source.type) {
    case "page": {
      const page = getArtifact(source.artifactId);
      if (!page || page.session_id !== session.id)
        return fail(404, "Not found");
      const html = await readArtifactHtml(page);
      if (html === null) return fail(404, "Not found");
      return {
        ok: true,
        body: prepareArtifact(html),
        headers: ARTIFACT_HEADERS,
      };
    }
    case "file":
      return entry.read ? serveFile(entry.read, roots) : fail(404, "Gone");
    case "plan": {
      if (entry.read) return serveFile(entry.read, roots);
      const item = source.chatItemId
        ? getItem(session.id, source.chatItemId)
        : undefined;
      return item?.kind === "plan" ? markdown(item.plan) : fail(404, "Gone");
    }
    case "log": {
      const file = entry.read ?? findOutputFile(source.taskId);
      return file ? serveFile(file, roots, true) : fail(404, "No output yet");
    }
    case "attached": {
      const item = getItem(session.id, source.itemId);
      const image = item?.kind === "user" ? item.images?.[source.index] : null;
      if (!image || !IMAGE_MEDIA.has(image.mediaType))
        return fail(404, "Not found");
      const data = Buffer.from(image.data, "base64");
      if (data.length > MAX_IMAGE_BYTES) return fail(413, "Too large");
      return {
        ok: true,
        body: new Uint8Array(data),
        headers: imageHeaders(image.mediaType),
      };
    }
    case "pr":
      return markdown(await prMarkdown(session));
    case "run": {
      const text = runMarkdown(source.runId, session.id);
      return text === null ? fail(404, "Not found") : markdown(text);
    }
    case "session-log": {
      const row = db
        .prepare(`SELECT markdown FROM session_logs WHERE session_id = ?`)
        .get(session.id) as { markdown: string } | undefined;
      return row ? markdown(row.markdown) : fail(404, "Not found");
    }
  }
}
