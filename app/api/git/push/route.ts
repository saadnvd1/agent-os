import { NextRequest, NextResponse } from "next/server";
import { forgetGitStatus } from "@/lib/git-poller";
import {
  push,
  isGitRepo,
  hasUpstream,
  getRemoteUrl,
  getGitStatus,
  expandPath,
} from "@/lib/git-status";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path: rawPath } = body as { path: string };

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

    // Check if remote exists
    const remoteUrl = getRemoteUrl(path);
    if (!remoteUrl) {
      return NextResponse.json(
        { error: "No remote origin configured" },
        { status: 400 }
      );
    }

    // Check if there are commits to push
    const status = await getGitStatus(path);
    if (status.ahead === 0) {
      forgetGitStatus(path);
      return NextResponse.json({
        success: true,
        message: "Already up to date",
        pushed: false,
      });
    }

    // Push (set upstream if needed)
    const needsUpstream = !hasUpstream(path);
    const output = push(path, needsUpstream);

    forgetGitStatus(path);
    return NextResponse.json({
      success: true,
      output,
      pushed: true,
      setUpstream: needsUpstream,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to push" },
      { status: 500 }
    );
  }
}
