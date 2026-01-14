import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb, queries, type Session, type Group } from "@/lib/db";
import { isValidAgentType, type AgentType } from "@/lib/providers";
import { createWorktree } from "@/lib/worktrees";
import { setupWorktree, type SetupResult } from "@/lib/env-setup";
import { findAvailablePort } from "@/lib/ports";

// GET /api/sessions - List all sessions and groups
export async function GET() {
  try {
    const db = getDb();
    const sessions = queries.getAllSessions(db).all() as Session[];
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

// Generate a unique session name
function generateSessionName(db: ReturnType<typeof getDb>): string {
  const sessions = queries.getAllSessions(db).all() as Session[];
  const existingNumbers = sessions
    .map((s) => {
      const match = s.name.match(/^Session (\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter((n) => n > 0);

  const nextNumber =
    existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
  return `Session ${nextNumber}`;
}

// POST /api/sessions - Create new session
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const db = getDb();

    const {
      name: providedName,
      workingDirectory = "~",
      parentSessionId = null,
      model = "sonnet",
      systemPrompt = null,
      groupPath = "sessions",
      claudeSessionId = null,
      agentType: rawAgentType = "claude",
      autoApprove = false,
      projectId = "uncategorized",
      // Worktree options
      useWorktree = false,
      featureName = null,
      baseBranch = "main",
    } = body;

    // Validate agent type
    const agentType: AgentType = isValidAgentType(rawAgentType)
      ? rawAgentType
      : "claude";

    // Auto-generate name if not provided
    const name =
      providedName?.trim() ||
      (featureName ? featureName : generateSessionName(db));

    const id = randomUUID();

    // Handle worktree creation if requested
    let worktreePath: string | null = null;
    let branchName: string | null = null;
    let actualWorkingDirectory = workingDirectory;
    let port: number | null = null;
    let setupResult: SetupResult | null = null;

    if (useWorktree && featureName) {
      try {
        const worktreeInfo = await createWorktree({
          projectPath: workingDirectory,
          featureName,
          baseBranch,
        });
        worktreePath = worktreeInfo.worktreePath;
        branchName = worktreeInfo.branchName;
        actualWorkingDirectory = worktreeInfo.worktreePath;

        // Find an available port for the dev server
        port = await findAvailablePort();

        // Run environment setup (copy env files, install dependencies)
        setupResult = await setupWorktree({
          worktreePath: worktreeInfo.worktreePath,
          sourcePath: workingDirectory,
          port,
        });

        console.log("Worktree setup completed:", {
          port,
          envFilesCopied: setupResult.envFilesCopied,
          stepsRun: setupResult.steps.length,
          success: setupResult.success,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json(
          { error: `Failed to create worktree: ${message}` },
          { status: 400 }
        );
      }
    }

    const tmuxName = `${agentType}-${id}`;
    queries.createSession(db).run(
      id,
      name,
      tmuxName,
      actualWorkingDirectory,
      parentSessionId,
      model,
      systemPrompt,
      groupPath,
      agentType,
      autoApprove ? 1 : 0, // SQLite stores booleans as integers
      projectId
    );

    // Set worktree info if created
    if (worktreePath) {
      queries
        .updateSessionWorktree(db)
        .run(worktreePath, branchName, baseBranch, port, id);
    }

    // Set claude_session_id if provided (for importing external sessions)
    if (claudeSessionId) {
      db.prepare("UPDATE sessions SET claude_session_id = ? WHERE id = ?").run(
        claudeSessionId,
        id
      );
    }

    // If forking, copy messages from parent
    if (parentSessionId) {
      const parentMessages = queries
        .getSessionMessages(db)
        .all(parentSessionId);
      for (const msg of parentMessages as Array<{
        role: string;
        content: string;
        duration_ms: number | null;
      }>) {
        queries
          .createMessage(db)
          .run(id, msg.role, msg.content, msg.duration_ms);
      }
    }

    const session = queries.getSession(db).get(id) as Session;

    // Include setup result in response if worktree was created
    const response: { session: Session; setup?: SetupResult } = { session };
    if (setupResult) {
      response.setup = setupResult;
    }

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Error creating session:", error);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }
}
