import { NextRequest, NextResponse } from "next/server";
import {
  commit,
  isGitRepo,
  isMainBranch,
  createBranch,
  getGitStatus,
  expandPath,
} from "@/lib/git-status";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      path: rawPath,
      message,
      branchName,
    } = body as {
      path: string;
      message: string;
      branchName?: string;
    };

    if (!rawPath) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    if (!message) {
      return NextResponse.json(
        { error: "Commit message is required" },
        { status: 400 }
      );
    }

    const path = expandPath(rawPath);

    if (!isGitRepo(path)) {
      return NextResponse.json(
        { error: "Not a git repository" },
        { status: 400 }
      );
    }

    // Check if there are staged changes
    const status = getGitStatus(path);
    if (status.staged.length === 0) {
      return NextResponse.json(
        { error: "No staged changes to commit" },
        { status: 400 }
      );
    }

    // Create new branch if on main/master and branch name provided
    let newBranch = false;
    if (branchName && isMainBranch(path)) {
      createBranch(path, branchName);
      newBranch = true;
    }

    // Commit
    const output = commit(path, message);

    return NextResponse.json({
      success: true,
      output,
      newBranch,
      branchName: newBranch ? branchName : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to commit" },
      { status: 500 }
    );
  }
}
