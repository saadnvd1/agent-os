// A page's versions for the version switcher: each with its note, size and
// the message that asked for it.

import { db } from "../db";
import { getArtifact, listVersions, type Artifact } from "./store";
import {
  pageActions,
  type ArtifactVersion,
  type PageVersions,
} from "./actions";

const PROMPT_CHARS = 80;

const sqliteMs = (t: string) =>
  Date.parse(t.includes("T") ? t : `${t.replace(" ", "T")}Z`) || 0;

// The user message before the chat item that showed this version.
function turnOf(a: Artifact): ArtifactVersion["turn"] {
  const row = db
    .prepare(
      `SELECT u.item_id AS itemId,
              json_extract(u.data, '$.text') AS text,
              (SELECT COUNT(*) FROM chat_items c
                WHERE c.session_id = u.session_id AND c.kind = 'user'
                  AND c.seq <= u.seq) AS idx
         FROM chat_items u
        WHERE u.session_id = ? AND u.kind = 'user'
          AND u.seq < (SELECT seq FROM chat_items
                        WHERE session_id = ? AND item_id = ?)
        ORDER BY u.seq DESC LIMIT 1`
    )
    .get(a.session_id, a.session_id, `artifact-${a.id}`) as
    { itemId: string; text: string | null; idx: number } | undefined;
  if (!row) return undefined;
  const prompt = (row.text ?? "").replace(/\s+/g, " ").trim();
  return {
    itemId: row.itemId,
    index: row.idx,
    prompt:
      prompt.length > PROMPT_CHARS
        ? `${prompt.slice(0, PROMPT_CHARS - 1)}…`
        : prompt,
  };
}

export function toVersion(a: Artifact): ArtifactVersion {
  const turn = turnOf(a);
  return {
    id: a.id,
    version: a.version,
    title: a.title,
    ...(a.note && { note: a.note }),
    createdAt: sqliteMs(a.created_at),
    ...(a.bytes != null && { bytes: a.bytes }),
    ...(turn && { turn }),
  };
}

// Every version of the page that artifactId is a version of.
export function pageVersions(
  artifactId: string,
  ctx: { pdf: boolean }
): PageVersions | undefined {
  const a = getArtifact(artifactId);
  if (!a) return undefined;
  const versions = listVersions(a.page_id).map(toVersion);
  return {
    pageId: a.page_id,
    title: versions[versions.length - 1]?.title ?? a.title,
    latestId: versions[versions.length - 1]?.id ?? a.id,
    versions,
    actions: pageActions({ ...ctx, versions: versions.length }),
  };
}
