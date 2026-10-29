/**
 * Pages a chat agent showed with html_render: one HTML file each under
 * ~/.agent-os/artifacts/<session id>/, and a row saying whose it is.
 */

import { agentosHome } from "../agentos-home";
import fs from "fs";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { db } from "../db";

export interface Artifact {
  id: string;
  session_id: string;
  title: string;
  path: string;
  created_at: string;
  // The page this is a version of; every version of a page shares it.
  page_id: string;
  version: number;
  // The agent's one line on what changed.
  note: string | null;
  bytes: number | null;
  sha256: string | null;
}

export interface SaveOptions {
  // Any version's id of a page in this session: add a version to it.
  update?: string;
  // With no update, the newest page in this session with the same title.
  sameTitle?: boolean;
  note?: string;
}

export interface Saved {
  artifact: Artifact;
  // False when the page was byte-for-byte its latest version already.
  created: boolean;
}

export const MAX_NOTE_CHARS = 120;

export const MAX_HTML_BYTES = 2 * 1024 * 1024;
export const MAX_TITLE_CHARS = 120;

const ID = /^[0-9a-f-]{36}$/;

export function artifactsDir(): string {
  return process.env.AGENTOS_ARTIFACTS_DIR || agentosHome("artifacts");
}

// Session ids are UUIDs; anything else must not become a path segment.
function sessionDir(sessionId: string): string {
  const safe = sessionId.replace(/[^\w-]/g, "_");
  return path.join(artifactsDir(), safe);
}

export function createArtifact(
  sessionId: string,
  title: string,
  html: string,
  opts: SaveOptions = {}
): Artifact {
  return saveArtifact(sessionId, title, html, opts).artifact;
}

const oneLine = (s: string, max: number) =>
  s.replace(/\s+/g, " ").trim().slice(0, max);

// Saves a page, or a new version of one. Earlier versions are never touched.
export function saveArtifact(
  sessionId: string,
  title: string,
  html: string,
  opts: SaveOptions = {}
): Saved {
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > MAX_HTML_BYTES)
    throw new Error("The page is over 2 MB; make it smaller.");
  const clean = oneLine(title, MAX_TITLE_CHARS) || "Untitled";
  const note = opts.note ? oneLine(opts.note, MAX_NOTE_CHARS) || null : null;
  const sha256 = createHash("sha256").update(html).digest("hex");
  const id = randomUUID();
  const dir = sessionDir(sessionId);
  const file = path.join(dir, `${id}.html`);
  return db.transaction((): Saved => {
    const pageId = resolvePage(sessionId, clean, opts);
    const latest = pageId ? latestVersion(pageId) : undefined;
    if (latest && latest.sha256 === sha256)
      return { artifact: latest, created: false };
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, html, { mode: 0o600 });
    db.prepare(
      `INSERT INTO artifacts (id, session_id, title, path, page_id, version, note, bytes, sha256)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      sessionId,
      clean,
      file,
      pageId ?? id,
      latest ? latest.version + 1 : 1,
      note,
      bytes,
      sha256
    );
    return { artifact: getArtifact(id)!, created: true };
  })();
}

function resolvePage(
  sessionId: string,
  title: string,
  opts: SaveOptions
): string | undefined {
  if (opts.update) {
    const base = getArtifact(opts.update);
    if (!base || base.session_id !== sessionId)
      throw new Error(
        `No page ${opts.update} in this chat; leave out update to show a new page.`
      );
    return base.page_id;
  }
  if (!opts.sameTitle) return undefined;
  const row = db
    .prepare(
      `SELECT page_id FROM artifacts WHERE session_id = ? AND lower(title) = lower(?)
       ORDER BY created_at DESC, rowid DESC LIMIT 1`
    )
    .get(sessionId, title) as { page_id: string } | undefined;
  return row?.page_id;
}

// Every version of a page, oldest first.
export function listVersions(pageId: string): Artifact[] {
  return db
    .prepare(`SELECT * FROM artifacts WHERE page_id = ? ORDER BY version`)
    .all(pageId) as Artifact[];
}

export function latestVersion(pageId: string): Artifact | undefined {
  return db
    .prepare(
      `SELECT * FROM artifacts WHERE page_id = ? ORDER BY version DESC LIMIT 1`
    )
    .get(pageId) as Artifact | undefined;
}

export function getArtifact(id: string): Artifact | undefined {
  if (!ID.test(id)) return undefined;
  return db.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(id) as
    Artifact | undefined;
}

export function listArtifacts(sessionId: string): Artifact[] {
  return db
    .prepare(
      `SELECT * FROM artifacts WHERE session_id = ? ORDER BY created_at, rowid`
    )
    .all(sessionId) as Artifact[];
}

// The page's HTML, read only from inside the artifacts folder.
export async function readArtifactHtml(
  artifact: Artifact
): Promise<string | null> {
  const root = path.resolve(artifactsDir());
  const file = path.resolve(artifact.path);
  if (!file.startsWith(root + path.sep)) return null;
  try {
    return await fs.promises.readFile(file, "utf8");
  } catch {
    return null;
  }
}
