import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { getDb, queries, type Session } from "@/lib/db";

const execAsync = promisify(exec);

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface PRInfo {
  number: number;
  url: string;
  state: string;
  title: string;
}

/**
 * Check if gh CLI is installed and authenticated
 */
async function checkGhCli(): Promise<boolean> {
  try {
    await execAsync("gh auth status", { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get PR info for a branch
 */
async function getPRForBranch(
  projectPath: string,
  branchName: string
): Promise<PRInfo | null> {
  try {
    const { stdout } = await execAsync(
      `gh pr list --head "${branchName}" --json number,url,state,title --limit 1`,
      { cwd: projectPath, timeout: 10000 }
    );
    const prs = JSON.parse(stdout);
    return prs.length > 0 ? prs[0] : null;
  } catch {
    return null;
  }
}

/**
 * Create a new PR for a branch
 */
async function createPR(
  projectPath: string,
  branchName: string,
  baseBranch: string,
  title: string,
  body?: string
): Promise<PRInfo> {
  // First push the branch if not already pushed
  try {
    await execAsync(`git push -u origin "${branchName}"`, {
      cwd: projectPath,
      timeout: 30000,
    });
  } catch {
    // Branch might already be pushed, continue
  }

  const bodyArg = body ? `--body "${body.replace(/"/g, '\\"')}"` : '--body ""';
  const { stdout } = await execAsync(
    `gh pr create --title "${title.replace(/"/g, '\\"')}" --base "${baseBranch}" ${bodyArg} --json number,url,state,title`,
    { cwd: projectPath, timeout: 30000 }
  );
  return JSON.parse(stdout);
}

// GET /api/sessions/[id]/pr - Get PR info for session
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = getDb();
    const session = queries.getSession(db).get(id) as Session | undefined;

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (!session.worktree_path || !session.branch_name) {
      return NextResponse.json(
        { error: "Session is not a worktree session" },
        { status: 400 }
      );
    }

    // Check gh CLI
    if (!(await checkGhCli())) {
      return NextResponse.json(
        {
          error:
            "GitHub CLI not installed or not authenticated. Run 'gh auth login' first.",
        },
        { status: 400 }
      );
    }

    const pr = await getPRForBranch(session.worktree_path, session.branch_name);

    // Update session with PR info if found
    if (pr) {
      queries.updateSessionPR(db).run(pr.url, pr.number, pr.state, id);
    }

    return NextResponse.json({ pr });
  } catch (error) {
    console.error("Error fetching PR:", error);
    return NextResponse.json(
      { error: "Failed to fetch PR info" },
      { status: 500 }
    );
  }
}

// POST /api/sessions/[id]/pr - Create PR for session
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, description } = body;

    const db = getDb();
    const session = queries.getSession(db).get(id) as Session | undefined;

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (!session.worktree_path || !session.branch_name) {
      return NextResponse.json(
        { error: "Session is not a worktree session" },
        { status: 400 }
      );
    }

    // Check gh CLI
    if (!(await checkGhCli())) {
      return NextResponse.json(
        {
          error:
            "GitHub CLI not installed or not authenticated. Run 'gh auth login' first.",
        },
        { status: 400 }
      );
    }

    // Check if PR already exists
    const existingPR = await getPRForBranch(
      session.worktree_path,
      session.branch_name
    );
    if (existingPR) {
      return NextResponse.json(
        { error: "PR already exists for this branch", pr: existingPR },
        { status: 409 }
      );
    }

    // Create PR
    const prTitle = title || session.name;
    const pr = await createPR(
      session.worktree_path,
      session.branch_name,
      session.base_branch || "main",
      prTitle,
      description
    );

    // Save PR info to session
    queries.updateSessionPR(db).run(pr.url, pr.number, pr.state, id);

    return NextResponse.json({ pr }, { status: 201 });
  } catch (error) {
    console.error("Error creating PR:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to create PR: ${message}` },
      { status: 500 }
    );
  }
}
