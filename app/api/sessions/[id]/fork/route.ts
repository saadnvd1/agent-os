import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb, queries, type Session, type Message } from "@/lib/db";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/sessions/[id]/fork - Fork a session
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: parentId } = await params;

    // Parse body if present, otherwise use empty object
    let body: { name?: string } = {};
    try {
      body = await request.json();
    } catch {
      // No body provided, use defaults
    }
    const { name } = body;

    const db = getDb();

    // Get parent session
    const parent = queries.getSession(db).get(parentId) as Session | undefined;
    if (!parent) {
      return NextResponse.json(
        { error: "Parent session not found" },
        { status: 404 }
      );
    }

    // Create new session
    const newId = randomUUID();
    const newName = name || `${parent.name} (fork)`;
    const agentType = parent.agent_type || "claude";
    const tmuxName = `${agentType}-${newId}`;

    queries
      .createSession(db)
      .run(
        newId,
        newName,
        tmuxName,
        parent.working_directory,
        parentId,
        parent.model,
        parent.system_prompt,
        parent.group_path || "sessions",
        agentType,
        parent.auto_approve ? 1 : 0,
        parent.project_id || "uncategorized"
      );

    // NOTE: We do NOT copy claude_session_id here.
    // When the forked session is first attached, it will use --fork-session flag
    // with the parent's claude_session_id to create a new branched conversation.
    // The new session ID will be captured automatically.

    // Copy any local messages from parent (for logging purposes)
    const parentMessages = queries
      .getSessionMessages(db)
      .all(parentId) as Message[];
    for (const msg of parentMessages) {
      queries
        .createMessage(db)
        .run(newId, msg.role, msg.content, msg.duration_ms);
    }

    const session = queries.getSession(db).get(newId) as Session;

    return NextResponse.json(
      {
        session,
        messagesCopied: parentMessages.length,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error forking session:", error);
    return NextResponse.json(
      { error: "Failed to fork session" },
      { status: 500 }
    );
  }
}
