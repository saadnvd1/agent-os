/**
 * Pages a chat agent showed with html_render: one HTML file each under
 * ~/.agent-os/artifacts/<session id>/, and a row saying whose it is.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { db } from "../db";

export interface Artifact {
  id: string;
  session_id: string;
  title: string;
  path: string;
  created_at: string;
}

export const MAX_HTML_BYTES = 2 * 1024 * 1024;
export const MAX_TITLE_CHARS = 120;

const ID = /^[0-9a-f-]{36}$/;

export function artifactsDir(): string {
  return (
    process.env.AGENTOS_ARTIFACTS_DIR ||
    path.join(os.homedir(), ".agent-os", "artifacts")
  );
}

// Session ids are UUIDs; anything else must not become a path segment.
function sessionDir(sessionId: string): string {
  const safe = sessionId.replace(/[^\w-]/g, "_");
  return path.join(artifactsDir(), safe);
}

export function createArtifact(
  sessionId: string,
  title: string,
  html: string
): Artifact {
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES)
    throw new Error("The page is over 2 MB; make it smaller.");
  const id = randomUUID();
  const dir = sessionDir(sessionId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${id}.html`);
  fs.writeFileSync(file, html, { mode: 0o600 });
  const clean = title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS);
  db.prepare(
    `INSERT INTO artifacts (id, session_id, title, path) VALUES (?, ?, ?, ?)`
  ).run(id, sessionId, clean || "Untitled", file);
  return getArtifact(id)!;
}

export function getArtifact(id: string): Artifact | undefined {
  if (!ID.test(id)) return undefined;
  return db.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(id) as
    | Artifact
    | undefined;
}

export function listArtifacts(sessionId: string): Artifact[] {
  return db
    .prepare(
      `SELECT * FROM artifacts WHERE session_id = ? ORDER BY created_at, rowid`
    )
    .all(sessionId) as Artifact[];
}

// The page's HTML, read only from inside the artifacts folder.
export function readArtifactHtml(artifact: Artifact): string | null {
  const root = path.resolve(artifactsDir());
  const file = path.resolve(artifact.path);
  if (!file.startsWith(root + path.sep)) return null;
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}
