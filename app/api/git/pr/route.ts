import { NextRequest, NextResponse } from "next/server";
import { isGitRepo } from "@/lib/git-status";
import {
  checkGhCli,
  getCommitsSinceBase,
  generatePRTitle,
  generatePRBody,
  getPRForBranch,
  createPR,
  getCurrentBranch,
  getBaseBranch,
} from "@/lib/pr";
import { generatePRContent } from "@/lib/pr-generation";

// GET /api/git/pr - Get PR status (fast - no AI generation)
// Use ?generate=true to also generate suggested title/body (slow - uses Claude CLI)
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const path = searchParams.get("path");
  const shouldGenerate = searchParams.get("generate") === "true";

  if (!path) {
    return NextResponse.json({ error: "Path is required" }, { status: 400 });
  }

  if (!isGitRepo(path)) {
    return NextResponse.json(
      { error: "Not a git repository" },
      { status: 400 }
    );
  }

  if (!checkGhCli()) {
    return NextResponse.json(
      {
        error:
          "GitHub CLI not installed or not authenticated. Run 'gh auth login' first.",
      },
      { status: 400 }
    );
  }

  try {
    const branch = getCurrentBranch(path);
    const baseBranch = getBaseBranch(path);

    // Check if on main/master (can't create PR from there)
    if (branch === "main" || branch === "master") {
      return NextResponse.json(
        { error: "Cannot create PR from main/master branch" },
        { status: 400 }
      );
    }

    // Check if PR already exists
    const existingPR = getPRForBranch(path, branch);

    // Get commits for listing
    const commits = getCommitsSinceBase(path, baseBranch);

    // Only generate suggested content if explicitly requested (for PR creation flow)
    let suggestedTitle: string | undefined;
    let suggestedBody: string | undefined;

    if (shouldGenerate) {
      try {
        const generated = await generatePRContent(path, baseBranch);
        suggestedTitle = generated.title;
        suggestedBody = generated.description;
      } catch {
        // Fallback to simple heuristic
        suggestedTitle = generatePRTitle(commits, branch);
        suggestedBody = generatePRBody(commits);
      }
    }

    return NextResponse.json({
      branch,
      baseBranch,
      existingPR,
      commits: commits.map((c) => ({ hash: c.hash, subject: c.subject })),
      ...(suggestedTitle && { suggestedTitle }),
      ...(suggestedBody && { suggestedBody }),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to get PR info",
      },
      { status: 500 }
    );
  }
}

// POST /api/git/pr - Create a new PR
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      path,
      title,
      description,
      baseBranch: customBase,
    } = body as {
      path: string;
      title: string;
      description: string;
      baseBranch?: string;
    };

    if (!path) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    if (!isGitRepo(path)) {
      return NextResponse.json(
        { error: "Not a git repository" },
        { status: 400 }
      );
    }

    if (!checkGhCli()) {
      return NextResponse.json(
        { error: "GitHub CLI not installed or not authenticated" },
        { status: 400 }
      );
    }

    const branch = getCurrentBranch(path);
    const baseBranch = customBase || getBaseBranch(path);

    // Check if on main/master
    if (branch === "main" || branch === "master") {
      return NextResponse.json(
        { error: "Cannot create PR from main/master branch" },
        { status: 400 }
      );
    }

    // Check if PR already exists
    const existingPR = getPRForBranch(path, branch);
    if (existingPR) {
      return NextResponse.json(
        { error: "PR already exists for this branch", pr: existingPR },
        { status: 409 }
      );
    }

    // Create the PR
    const pr = createPR(path, branch, baseBranch, title, description || "");

    return NextResponse.json({ pr }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to create PR: ${message}` },
      { status: 500 }
    );
  }
}
