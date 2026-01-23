import { NextRequest, NextResponse } from "next/server";
import {
  isGitRepo,
  getBranches,
  getDefaultBranch,
  getCurrentBranch,
} from "@/lib/git";

/**
 * POST /api/git/check
 * Check if a path is a git repository and return branch info
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path: dirPath, projectId = "local" } = body;

    if (!dirPath) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    // Check if it's a git repo (use "local" as projectId for local-only checks)
    const isRepo = await isGitRepo(projectId, dirPath);

    if (!isRepo) {
      return NextResponse.json({
        isGitRepo: false,
        branches: [],
        defaultBranch: null,
        currentBranch: null,
      });
    }

    // Get branch info
    const [branches, defaultBranch, currentBranch] = await Promise.all([
      getBranches(projectId, dirPath),
      getDefaultBranch(projectId, dirPath),
      getCurrentBranch(projectId, dirPath),
    ]);

    return NextResponse.json({
      isGitRepo: true,
      branches,
      defaultBranch,
      currentBranch,
    });
  } catch (error) {
    console.error("Error checking git repo:", error);
    return NextResponse.json(
      { error: "Failed to check git repository" },
      { status: 500 }
    );
  }
}
