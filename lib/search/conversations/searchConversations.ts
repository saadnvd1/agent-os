import { getDb } from "@/lib/db";
import { buildMatchQuery } from "./buildMatchQuery";
import { indexProgress } from "./backfill";
import type {
  ConversationGroup,
  ConversationHit,
  SearchResponse,
  SearchScope,
  SnippetSegment,
} from "./types";

// Best matches pulled before they are grouped by conversation.
const CANDIDATES = 200;
const HITS_PER_SESSION = 3;
export const MAX_GROUPS = 30;

const OPEN = "\u0002";
const CLOSE = "\u0003";

interface Row {
  session_id: string;
  item_id: string;
  snippet: string;
  kind: "user" | "assistant";
  created_at: number | null;
  name: string;
  status: string;
  task_status: string | null;
  archived_at: string | null;
  updated_at: string | null;
  project_id: string | null;
  project_name: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
}

export function parseSnippet(raw: string): SnippetSegment[] {
  const out: SnippetSegment[] = [];
  let hit = false;
  let text = "";
  for (const ch of raw) {
    if (ch === OPEN || ch === CLOSE) {
      if (text) out.push({ text, hit });
      text = "";
      hit = ch === OPEN;
    } else text += ch;
  }
  if (text) out.push({ text, hit });
  return out;
}

// done/dropped/merged tasks and archived sessions keep their conversation,
// so the label says what became of the session.
function statusOf(r: Row): string {
  if (r.archived_at) return "archived";
  if (r.task_status && r.task_status !== "running") return r.task_status;
  return r.status;
}

export function searchConversations(
  q: string,
  scope: SearchScope,
  page: { offset?: number; limit?: number } = {}
): SearchResponse {
  const started = performance.now();
  const parsed = buildMatchQuery(q);
  const empty: SearchResponse = {
    groups: [],
    more: false,
    tookMs: 0,
    indexing: indexProgress(),
    terms: [],
  };
  if (!parsed) return empty;

  const where: string[] = [];
  const args: unknown[] = [parsed.match];
  if (scope.workspace !== "all") {
    where.push(`COALESCE(s.workspace_id, p.workspace_id) = ?`);
    args.push(scope.workspace);
  }
  if (scope.project) {
    where.push(`s.project_id = ?`);
    args.push(scope.project);
  }
  args.push(CANDIDATES);
  const rows = getDb()
    .prepare(
      `WITH hits AS (
         SELECT k.session_id, k.item_id, bm25(chat_search) AS rank,
                snippet(chat_search, 0, '${OPEN}', '${CLOSE}', '…', 18) AS snippet
         FROM chat_search
         JOIN chat_search_keys k ON k.id = chat_search.rowid
         JOIN sessions s ON s.id = k.session_id
         LEFT JOIN projects p ON p.id = s.project_id
         WHERE chat_search MATCH ? ${where.map((w) => `AND ${w}`).join(" ")}
         ORDER BY rank LIMIT ?
       )
       SELECT h.session_id, h.item_id, h.snippet, c.kind,
              json_extract(c.data, '$.createdAt') AS created_at,
              s.name, s.status, s.task_status, s.archived_at, s.updated_at,
              s.project_id, p.name AS project_name,
              COALESCE(s.workspace_id, p.workspace_id) AS workspace_id,
              w.name AS workspace_name
       FROM hits h
       JOIN chat_items c ON c.session_id = h.session_id AND c.item_id = h.item_id
       JOIN session_rows s ON s.id = h.session_id
       LEFT JOIN projects p ON p.id = s.project_id
       LEFT JOIN workspaces w ON w.id = COALESCE(s.workspace_id, p.workspace_id)
       ORDER BY h.rank`
    )
    .all(...args) as Row[];

  const groups = new Map<string, ConversationGroup>();
  for (const r of rows) {
    let g = groups.get(r.session_id);
    if (!g) {
      g = {
        sessionId: r.session_id,
        name: r.name,
        projectId: r.project_id,
        projectName: r.project_name,
        workspaceId: r.workspace_id,
        workspaceName: r.workspace_name,
        status: statusOf(r),
        updatedAt: r.updated_at,
        hits: [],
      };
      groups.set(r.session_id, g);
    }
    if (g.hits.length < HITS_PER_SESSION) {
      const hit: ConversationHit = {
        itemId: r.item_id,
        role: r.kind,
        createdAt: r.created_at,
        snippet: parseSnippet(r.snippet),
      };
      g.hits.push(hit);
    }
  }
  const all = [...groups.values()];
  const offset = Math.max(0, page.offset ?? 0);
  const limit = Math.min(MAX_GROUPS, Math.max(1, page.limit ?? 20));
  return {
    groups: all.slice(offset, offset + limit),
    more: all.length > offset + limit,
    tookMs: Math.round((performance.now() - started) * 10) / 10,
    indexing: indexProgress(),
    terms: parsed.terms,
  };
}
