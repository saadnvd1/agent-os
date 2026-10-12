import { NextRequest, NextResponse } from "next/server";
import { gitCheck } from "@/lib/git";

/**
 * POST /api/git/check
 * Check if a path is a git repository and return branch info
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path: dirPath } = body;

    if (!dirPath) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    return NextResponse.json(await gitCheck(dirPath));
  } catch (error) {
    console.error("Error checking git repo:", error);
    return NextResponse.json(
      { error: "Failed to check git repository" },
      { status: 500 }
    );
  }
}
