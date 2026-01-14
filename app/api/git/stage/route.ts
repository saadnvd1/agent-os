import { NextRequest, NextResponse } from "next/server";
import { stageFile, stageAll, isGitRepo, expandPath } from "@/lib/git-status";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path: rawPath, files } = body as { path: string; files?: string[] };

    if (!rawPath) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    const path = expandPath(rawPath);

    if (!isGitRepo(path)) {
      return NextResponse.json(
        { error: "Not a git repository" },
        { status: 400 }
      );
    }

    // Stage specific files or all
    if (files && files.length > 0) {
      for (const file of files) {
        stageFile(path, file);
      }
    } else {
      stageAll(path);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to stage files",
      },
      { status: 500 }
    );
  }
}
