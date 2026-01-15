import { NextRequest, NextResponse } from "next/server";
import { discardChanges, isGitRepo, expandPath } from "@/lib/git-status";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path: rawPath, file } = body as { path: string; file: string };

    if (!rawPath) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    if (!file) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }

    const path = expandPath(rawPath);

    if (!isGitRepo(path)) {
      return NextResponse.json(
        { error: "Not a git repository" },
        { status: 400 }
      );
    }

    discardChanges(path, file);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to discard changes",
      },
      { status: 500 }
    );
  }
}
