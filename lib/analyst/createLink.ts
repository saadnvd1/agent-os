import { db, type Session } from "../db";
import { lastItems } from "../chat/store";
import { launchSession } from "../sessions/launch";
import { joinCrew } from "../sessions/crew";
import { inheritGroup } from "../session-groups";
import { isValidAgentType } from "../providers";
import { archiveSession } from "../done/archive";
import { ANALYST_BRIEF } from "./brief";
import { pushDigest } from "./pushDigest";
import { getLink, insertLink, liveLinkFor, linkOfAnalyst } from "./store";
import { AnalystError, type AnalystLink, type CreateLinkInput } from "./types";

const sessionRow = (id: string) =>
  db.prepare(`SELECT * FROM session_rows WHERE id = ?`).get(id) as
    Session | undefined;

// Why a session can't have an analyst, or null when it can.
export function coderRefusal(s: Session | undefined): string | null {
  if (!s) return "Session not found";
  if (s.archived_at) return `${s.name} is archived`;
  if (s.role === "orchestrator") return "An orchestrator can't have an analyst";
  if (s.view !== "chat")
    return "Only a chat session can have an analyst: a terminal has no turns to review";
  if ((s.host_id || "local") !== "local")
    return "Only a session on this machine can have an analyst for now";
  if (linkOfAnalyst(s.id)) return `${s.name} is an analyst itself`;
  if (liveLinkFor(s.id)) return `${s.name} already has an analyst`;
  return null;
}

const lastTurnEnd = (sessionId: string) =>
  lastItems(sessionId, 1, "turn_end")[0]?.id ?? null;

async function newCoder(
  input: NonNullable<CreateLinkInput["newCoder"]>
): Promise<Session> {
  if (!isValidAgentType(input.agentType))
    throw new AnalystError(`Unknown agent: ${input.agentType}`);
  const { session } = await launchSession({
    projectId: input.projectId,
    agentType: input.agentType,
    model: input.model ?? null,
    prompt: input.prompt ?? null,
    useWorktree: input.useWorktree,
    view: "chat",
  });
  return sessionRow(session.id) ?? session;
}

/**
 * Pairs an analyst with a coding chat: the analyst is a new chat in the
 * coder's folder (no worktree of its own, so it reads exactly what the
 * coder changed), in its crew and group. It reviews from the next turn on,
 * or the last one now with `reviewLast`.
 */
export async function createLink(input: CreateLinkInput): Promise<AnalystLink> {
  let coder: Session | undefined;
  if (input.coderSessionId) {
    coder = sessionRow(input.coderSessionId);
    const refusal = coderRefusal(coder);
    if (refusal) throw new AnalystError(refusal, coder ? 409 : 404);
  } else coder = await newCoder(input.newCoder!);
  if (!coder) throw new AnalystError("Session not found", 404);

  const crewId = coder.crew_id || coder.id;
  if (!coder.agent_role) joinCrew(coder.id, "developer", { crewId });
  const { session: analyst } = await launchSession({
    projectId: coder.project_id,
    workingDirectory: coder.working_directory,
    workspaceId: coder.workspace_id,
    agentType: "claude",
    model: input.analystModel ?? null,
    agentRole: "analyst",
    crewId,
    parentSessionId: coder.id,
    systemPrompt: ANALYST_BRIEF,
    access: "ask",
    useWorktree: false,
    view: "chat",
    name: `Analyst · ${coder.name}`,
  });
  inheritGroup(coder.id, analyst.id);

  const review = !!input.reviewLast;
  let link: AnalystLink;
  try {
    link = insertLink(
      coder.id,
      analyst.id,
      review ? null : lastTurnEnd(coder.id)
    );
  } catch {
    archiveSession(analyst.id);
    throw new AnalystError(`${coder.name} already has an analyst`, 409);
  }
  if (review && lastTurnEnd(coder.id)) await pushDigest(link.id);
  return getLink(link.id)!;
}
