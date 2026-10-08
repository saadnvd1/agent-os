import { NextRequest, NextResponse } from "next/server";
import { forgetGitStatus } from "@/lib/git-poller";
import {
  unstageFile,
  unstageAll,
  isGitRepo,
  expandPath,
} from "@/lib/git-status";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path: rawPath, files } = body as { path: string; files?: string[] };

    if (!rawPath) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    const path = expandPath(rawPath);

    if (!(await isGitRepo(path))) {
      return NextResponse.json(
        { error: "Not a git repository" },
        { status: 400 }
      );
    }

    // Unstage specific files or all
    if (files && files.length > 0) {
      for (const file of files) {
        await unstageFile(path, file);
      }
    } else {
      await unstageAll(path);
    }

    forgetGitStatus(path);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to unstage files",
      },
      { status: 500 }
    );
  }
}
