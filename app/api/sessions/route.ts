import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session, type Group } from "@/lib/db";
import { isValidAgentType } from "@/lib/providers";
import { clientSend } from "@/lib/chat/client-send";
import { CHAT_ACCESS } from "@/lib/chat/events";
import { launchSession } from "@/lib/sessions/launch";

// GET /api/sessions - List all sessions and groups
export async function GET() {
  try {
    const db = getDb();
    // Merged and dropped tasks live in the Tasks panel, archived sessions
    // in the Archived view: neither is in the sidebar.
    const sessions = (queries.getAllSessions(db).all() as Session[]).filter(
      (s) =>
        !s.archived_at &&
        s.task_status !== "merged" &&
        s.task_status !== "dropped"
    );
    const groups = queries.getAllGroups(db).all() as Group[];

    // Convert expanded from 0/1 to boolean
    const formattedGroups = groups.map((g) => ({
      ...g,
      expanded: Boolean(g.expanded),
    }));

    return NextResponse.json({ sessions, groups: formattedGroups });
  } catch (error) {
    console.error("Error fetching sessions:", error);
    return NextResponse.json(
      { error: "Failed to fetch sessions" },
      { status: 500 }
    );
  }
}

// POST /api/sessions - Create a session: a draft's first send, a terminal,
// a fork or an imported conversation.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const firstMessage = (b: Record<string, unknown>) => {
    const { text, images } = clientSend({ text: b.prompt, images: b.images });
    return { prompt: text, images };
  };
  try {
    const { session, initialPrompt } = await launchSession({
      projectId: str(body.projectId),
      workingDirectory: str(body.workingDirectory),
      agentType:
        typeof body.agentType === "string" && isValidAgentType(body.agentType)
          ? body.agentType
          : "claude",
      model: str(body.model),
      autoApprove: body.autoApprove === true,
      access: CHAT_ACCESS.find((a) => a === body.access),
      hostId: str(body.hostId),
      useWorktree: body.useWorktree === true,
      baseBranch: str(body.baseBranch),
      ...firstMessage(body),
      name: str(body.name),
      view: body.view === "terminal" ? "terminal" : undefined,
      parentSessionId: str(body.parentSessionId),
      groupPath: str(body.groupPath) ?? undefined,
      systemPrompt: str(body.systemPrompt),
    });
    const db = getDb();
    const claudeSessionId = str(body.claudeSessionId);
    // An imported conversation resumes the agent's own session.
    if (claudeSessionId)
      db.prepare("UPDATE sessions SET claude_session_id = ? WHERE id = ?").run(
        claudeSessionId,
        session.id
      );
    // A fork starts with its parent's messages.
    if (session.parent_session_id) {
      const parentMessages = queries
        .getSessionMessages(db)
        .all(session.parent_session_id) as Array<{
        role: string;
        content: string;
        duration_ms: number | null;
      }>;
      for (const msg of parentMessages)
        queries
          .createMessage(db)
          .run(session.id, msg.role, msg.content, msg.duration_ms);
    }
    return NextResponse.json(
      {
        session: queries.getSession(db).get(session.id) as Session,
        ...(initialPrompt ? { initialPrompt } : {}),
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error creating session:", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
