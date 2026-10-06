import {
  db,
  itemIds,
  stackQueries as q,
  type StackItemRow,
  type StackRow,
} from "../db";
import { getProject } from "../projects";
import { connectedClient } from "../lumifyhub/connection";
import { linkedWorkspaceFor } from "../lumifyhub/links";
import { cardUrl } from "../lumifyhub/urls";
import { itemName } from "./guard";
import { waitingOn } from "./ready";
import type { StackItemView, StackView } from "./types";

// Depth in the tree, root = 0, from each item's parent.
export function depths<T extends { id: string; parentId: string | null }>(
  items: T[]
): Map<string, number> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out = new Map<string, number>();
  const depthOf = (id: string, seen = new Set<string>()): number => {
    if (out.has(id)) return out.get(id)!;
    const parent = byId.get(id)?.parentId;
    const d =
      parent && byId.has(parent) && !seen.has(parent)
        ? 1 + depthOf(parent, seen.add(id))
        : 0;
    out.set(id, d);
    return d;
  };
  for (const i of items) depthOf(i.id);
  return out;
}

function cardLinker(projectId: string): (cardId: string) => string | null {
  const project = getProject(projectId);
  const client = connectedClient();
  if (!project || !client) return () => null;
  try {
    const slug = linkedWorkspaceFor(project).lh_workspace_slug!;
    return (id) => cardUrl(client.baseUrl, slug, project.lh_board_page_id, id);
  } catch {
    return () => null;
  }
}

const prUrlOf = (sessionId: string | null) =>
  sessionId
    ? ((
        db
          .prepare(`SELECT pr_url FROM sessions WHERE id = ?`)
          .get(sessionId) as { pr_url: string | null } | undefined
      )?.pr_url ?? null)
    : null;

export function stackView(row: StackRow): StackView {
  const rows = q.items(db, row.id);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const link = cardLinker(row.project_id);
  const depth = depths(
    rows.map((r) => ({ id: r.id, parentId: r.parent_item_id }))
  );
  const view = (r: StackItemRow): StackItemView => ({
    id: r.id,
    cardId: r.lh_card_id,
    ticket: r.ticket,
    title: r.title,
    status: r.status,
    depth: depth.get(r.id) ?? 0,
    parentId: r.parent_item_id,
    also: itemIds(r.also_item_ids)
      .map((id) => byId.get(id))
      .filter((i): i is StackItemRow => !!i)
      .map(itemName),
    waitsOn: r.status === "planned" ? waitingOn(r, byId) : null,
    note: r.note,
    error: r.error,
    taskId: r.session_id,
    prNumber: r.pr_number,
    prUrl: prUrlOf(r.session_id),
    baseBranch: r.base_branch,
    cardUrl: link(r.lh_card_id),
  });
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    projectId: row.project_id,
    projectName: getProject(row.project_id)?.name ?? null,
    maxParallel: row.max_parallel,
    progress: row.progress,
    error: row.error,
    createdAt: row.created_at,
    landedAt: row.landed_at,
    items: rows.map(view),
  };
}
