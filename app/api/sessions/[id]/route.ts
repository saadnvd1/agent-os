import { NextRequest, NextResponse } from "next/server";
import { deletionRefusal } from "@/lib/orchestrator/home";
import { getDb, queries, type Session } from "@/lib/db";
import { deleteWorktree, isAgentOSWorktree } from "@/lib/worktrees";
import { releasePort } from "@/lib/ports";
import { killWorker } from "@/lib/orchestration";
import { hostExec } from "@/lib/hosts";
import { shellQuote } from "@/lib/hosts/ssh";
import { supportsChat } from "@/lib/chat/capabilities";
import { stopChat } from "@/lib/chat/runner";
import { statusDetector } from "@/lib/status-detector";
import { deleteItems } from "@/lib/chat/store";
import { clearQueue } from "@/lib/chat/queued";
import { recordPreviousName } from "@/lib/session-names";
import { generateBranchName, getCurrentBranch, renameBranch } from "@/lib/git";
import { runInBackground } from "@/lib/async-operations";

// Sanitize a name for use as tmux session name
function sanitizeTmuxName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-") // Replace non-alphanumeric with dashes
    .replace(/-+/g, "-") // Collapse multiple dashes
    .replace(/^-|-$/g, "") // Remove leading/trailing dashes
    .slice(0, 50); // Limit length
}

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

    const existing = queries.getSession(db).get(id) as Session | undefined;
    if (!existing) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Build update query dynamically based on provided fields
    const updates: string[] = [];
    const values: unknown[] = [];

    // Chat and terminal drive the same conversation, never both at once.
    if (body.view === "chat" || body.view === "terminal") {
      if (body.view === "chat" && !supportsChat(existing.agent_type)) {
        return NextResponse.json(
          { error: `${existing.agent_type} sessions can't run as chat yet` },
          { status: 400 }
        );
      }
      if (body.view === "chat" && existing.view !== "chat") {
        // Switching kills the terminal's agent, so never while it's working.
        if (existing.task_prompt)
          return NextResponse.json(
            { error: "Tasks run in the terminal" },
            { status: 400 }
          );
        if (
          existing.tmux_name &&
          (await statusDetector.getStatus(existing.tmux_name)) === "running"
        )
          return NextResponse.json(
            {
              error:
                "The agent is working in the terminal; switch once it's done",
            },
            { status: 409 }
          );
      }
      if (body.view === "terminal") stopChat(id);
      if (body.view === "chat" && existing.tmux_name) {
        await hostExec(
          existing.host_id,
          `tmux kill-session -t ${shellQuote(`=${existing.tmux_name}`)} 2>/dev/null || true`
        ).catch(() => {});
      }
      updates.push("view = ?");
      values.push(body.view);
    }

    // Handle name change - also rename tmux session and git branch (for worktrees)
    if (body.name !== undefined && body.name !== existing.name) {
      const newTmuxName = sanitizeTmuxName(body.name);
      const oldTmuxName = existing.tmux_name;

      // Try to rename the tmux session
      if (oldTmuxName && newTmuxName) {
        try {
          await hostExec(
            existing.host_id,
            `tmux rename-session -t "${oldTmuxName}" "${newTmuxName}"`
          );
          updates.push("tmux_name = ?");
          values.push(newTmuxName);
        } catch {
          // tmux session might not exist or rename failed - that's ok, just update the name
          // Still update tmux_name in DB so future attachments use the new name
          updates.push("tmux_name = ?");
          values.push(newTmuxName);
        }
      }

      // A worktree session's unpushed branch follows its name. A task's
      // branch never does: its agent was told the name, and its PR is
      // looked up by it.
      if (
        existing.worktree_path &&
        !existing.task_status &&
        isAgentOSWorktree(existing.worktree_path)
      ) {
        try {
          const currentBranch = await getCurrentBranch(existing.worktree_path);
          const newBranchName = generateBranchName(body.name);

          if (currentBranch !== newBranchName) {
            await renameBranch(
              existing.worktree_path,
              currentBranch,
              newBranchName
            );
            // Only once git has it.
            updates.push("branch_name = ?");
            values.push(newBranchName);
            console.log(`Renamed branch ${currentBranch} → ${newBranchName}`);
          }
        } catch (error) {
          console.error("Branch kept its name:", error);
          // Continue with session rename even if branch rename fails
        }
      }

      // Messages sent to the old name still find it.
      recordPreviousName(id, existing.name);
      updates.push("name = ?", "name_source = 'user'");
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

      db.prepare(`UPDATE sessions SET ${updates.join(", ")} WHERE id = ?`).run(
        ...values
      );
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
    const refusal = deletionRefusal(existing);
    if (refusal) return NextResponse.json({ error: refusal }, { status: 409 });

    // If this is a conductor, delete all its workers first
    const workers = queries.getWorkersByConductor(db).all(id) as Session[];
    for (const worker of workers) {
      try {
        await killWorker(worker.id, false); // false = don't cleanup worktree yet
      } catch (error) {
        console.error(`Failed to kill worker ${worker.id}:`, error);
      }
      queries.deleteSession(db).run(worker.id);
    }

    // Release port if this session had one assigned
    if (existing.dev_server_port) {
      releasePort(id);
    }

    // Delete from database immediately for instant UI feedback
    stopChat(id);
    deleteItems(id);
    clearQueue(id);
    queries.deleteSession(db).run(id);

    // Clean up worktree in background (non-blocking)
    if (existing.worktree_path && isAgentOSWorktree(existing.worktree_path)) {
      const worktreePath = existing.worktree_path; // Capture for closure
      runInBackground(async () => {
        const { exec } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(exec);

        const { stdout } = await execAsync(
          `git -C "${worktreePath}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo ""`,
          { timeout: 5000 }
        );
        const gitCommonDir = stdout.trim().replace(/\/.git$/, "");

        if (gitCommonDir) {
          await deleteWorktree(worktreePath, gitCommonDir, false);
        }
      }, `cleanup-worktree-${id}`);
    }

    // Also cleanup worker worktrees in background
    if (workers.length > 0) {
      for (const worker of workers) {
        if (worker.worktree_path && isAgentOSWorktree(worker.worktree_path)) {
          const worktreePath = worker.worktree_path; // Capture for closure
          const workerId = worker.id; // Capture ID for task name
          runInBackground(async () => {
            const { exec } = await import("child_process");
            const { promisify } = await import("util");
            const execAsync = promisify(exec);

            const { stdout } = await execAsync(
              `git -C "${worktreePath}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo ""`,
              { timeout: 5000 }
            );
            const gitCommonDir = stdout.trim().replace(/\/.git$/, "");

            if (gitCommonDir) {
              await deleteWorktree(worktreePath, gitCommonDir, false);
            }
          }, `cleanup-worker-worktree-${workerId}`);
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting session:", error);
    return NextResponse.json(
      { error: "Failed to delete session" },
      { status: 500 }
    );
  }
}
