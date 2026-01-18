import { NextRequest, NextResponse } from "next/server";
import { getProjectRepositories, getProject } from "@/lib/projects";
import { getMultiRepoGitStatus } from "@/lib/multi-repo-git";
import { expandPath } from "@/lib/git-status";

// GET /api/git/multi-status - Get aggregated git status for a project's repositories
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const fallbackPath = searchParams.get("fallbackPath");

    if (!projectId && !fallbackPath) {
      return NextResponse.json(
        { error: "Either projectId or fallbackPath is required" },
        { status: 400 }
      );
    }

    let repositories: ReturnType<typeof getProjectRepositories> = [];

    if (projectId) {
      const project = getProject(projectId);
      if (!project) {
        return NextResponse.json(
          { error: "Project not found" },
          { status: 404 }
        );
      }
      repositories = getProjectRepositories(projectId);
    }

    // Get aggregated status
    const expandedFallback = fallbackPath
      ? expandPath(fallbackPath)
      : undefined;
    const status = getMultiRepoGitStatus(repositories, expandedFallback);

    return NextResponse.json(status);
  } catch (error) {
    console.error("Error fetching multi-repo git status:", error);
    return NextResponse.json(
      { error: "Failed to fetch git status" },
      { status: 500 }
    );
  }
}
