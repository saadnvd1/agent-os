import { db, insertSessionRow } from "../../db";
import { saveItem } from "../../chat/store";
import type { ChatOrigin } from "../../chat/events";
import { joinCrew } from "../../sessions/crew";
import type { LaunchInput } from "../../sessions/launch";

export interface Sent {
  sessionId: string;
  text: string;
  id?: string;
  origin?: ChatOrigin;
}

export const sent: Sent[] = [];
export const launched: LaunchInput[] = [];

// sendChat, delivered at once as the worker would save it.
export async function fakeSendChat(
  sessionId: string,
  m: { text: string; id?: string; origin?: ChatOrigin }
) {
  sent.push({ sessionId, ...m });
  saveItem(sessionId, {
    id: m.id ?? `user-${sent.length}`,
    createdAt: Date.now(),
    kind: "user",
    text: m.text,
    origin: m.origin,
  });
}

// launchSession, as a row only: no worker, no model.
export async function fakeLaunch(input: LaunchInput) {
  launched.push(input);
  const id = `analyst-${Math.random()}`;
  insertSessionRow(db, {
    id,
    name: input.name ?? id,
    tmux_name: id,
    project_id: input.projectId ?? "uncategorized",
    working_directory: input.workingDirectory ?? "/tmp",
    system_prompt: input.systemPrompt ?? null,
    view: "chat",
  });
  if (input.agentRole) joinCrew(id, input.agentRole, { crewId: input.crewId });
  return {
    session: db.prepare(`SELECT * FROM session_rows WHERE id = ?`).get(id),
  };
}
