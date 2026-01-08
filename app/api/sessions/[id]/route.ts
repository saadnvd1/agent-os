import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { deleteWorktree, isAgentOSWorktree } from "@/lib/worktrees";
import { releasePort } from "@/lib/ports";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/sessions/[id] - Get single session
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = getDb();
    const session = queries.getSession(db).get(id) as Session | undefined;

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({ session });
  } catch (error) {
    console.error("Error fetching session:", error);
    return NextResponse.json(
      { error: "Failed to fetch session" },
      { status: 500 }
    );
  }
}

// PATCH /api/sessions/[id] - Update session
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const db = getDb();

    const existing = queries.getSession(db).get(id);
    if (!existing) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Build update query dynamically based on provided fields
    const updates: string[] = [];
    const values: unknown[] = [];

    if (body.name !== undefined) {
      updates.push("name = ?");
      values.push(body.name);
    }
    if (body.status !== undefined) {
      updates.push("status = ?");
      values.push(body.status);
    }
    if (body.workingDirectory !== undefined) {
      updates.push("working_directory = ?");
      values.push(body.workingDirectory);
    }
    if (body.systemPrompt !== undefined) {
      updates.push("system_prompt = ?");
      values.push(body.systemPrompt);
    }
    if (body.groupPath !== undefined) {
      updates.push("group_path = ?");
      values.push(body.groupPath);
    }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      values.push(id);

      db.prepare(
        `UPDATE sessions SET ${updates.join(", ")} WHERE id = ?`
      ).run(...values);
    }

    const session = queries.getSession(db).get(id) as Session;
    return NextResponse.json({ session });
  } catch (error) {
    console.error("Error updating session:", error);
    return NextResponse.json(
      { error: "Failed to update session" },
      { status: 500 }
    );
  }
}

// DELETE /api/sessions/[id] - Delete session
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = getDb();

    const existing = queries.getSession(db).get(id) as Session | undefined;
    if (!existing) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Release port if this session had one assigned
    if (existing.dev_server_port) {
      releasePort(id);
    }

    // Clean up worktree if this was a worktree session
    if (existing.worktree_path && isAgentOSWorktree(existing.worktree_path)) {
      try {
        // Find the original project path (worktree_path's parent repo)
        // The working_directory for worktree sessions IS the worktree_path
        // We need to find where the main repo is
        // For now, we'll try to get it from the worktree's git config
        const { exec } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(exec);

        const { stdout } = await execAsync(
          `git -C "${existing.worktree_path}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo ""`,
          { timeout: 5000 }
        );
        const gitCommonDir = stdout.trim().replace(/\/.git$/, "");

        if (gitCommonDir) {
          await deleteWorktree(existing.worktree_path, gitCommonDir, false);
        }
      } catch (error) {
        console.error("Error cleaning up worktree:", error);
        // Continue with session deletion even if worktree cleanup fails
      }
    }

    queries.deleteSession(db).run(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting session:", error);
    return NextResponse.json(
      { error: "Failed to delete session" },
      { status: 500 }
    );
  }
}
