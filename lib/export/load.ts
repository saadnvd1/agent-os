import type { ChatItem } from "../chat/events";
import { getSession } from "../chat/registry";
import { listItems } from "../chat/store";
import { getArtifact, readArtifactHtml } from "../artifacts/store";
import { getProject } from "../projects";
import { visible } from "../share/snapshot";
import { BadShare } from "../share/service";

export interface Loaded {
  items: ChatItem[];
  meta: {
    name: string;
    agent: string;
    model?: string;
    project?: string;
    createdAt: number;
  };
  /** Changes whenever the conversation does. */
  key: string;
}

// SQLite stores "YYYY-MM-DD HH:MM:SS" in UTC.
const parseTime = (s: string) =>
  Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(" ", "T") + "Z") ||
  Date.now();

/** The session's chat as the reader sees it. 404 and 400 as BadShare. */
export function loadSession(sessionId: string): Loaded {
  let s;
  try {
    s = getSession(sessionId);
  } catch {
    throw new BadShare("Session not found", 404);
  }
  if (s.view !== "chat")
    throw new BadShare("Only chat sessions can be exported.", 400);
  const items = visible(listItems(sessionId));
  const last = items[items.length - 1];
  return {
    items,
    meta: {
      name: s.name,
      agent: s.agent_type,
      model: s.model || undefined,
      project: s.project_id ? getProject(s.project_id)?.name : undefined,
      createdAt: parseTime(s.created_at),
    },
    key: `${items.length}:${last?.id ?? ""}:${last ? JSON.stringify(last).length : 0}`,
  };
}

/** The pages of every artifact in the items, by id. Full exports only. */
export async function loadArtifacts(
  items: ChatItem[]
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const item of items) {
    if (item.kind !== "artifact") continue;
    const artifact = getArtifact(item.artifactId);
    const html = artifact ? await readArtifactHtml(artifact) : null;
    if (html !== null) out[item.artifactId] = html;
  }
  return out;
}
