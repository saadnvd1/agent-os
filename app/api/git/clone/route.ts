import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs/promises";

const execAsync = promisify(exec);

/**
 * POST /api/git/clone
 * Clone a git repository into a target directory
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, directory } = body;

    if (!url) {
      return NextResponse.json(
        { error: "Repository URL is required" },
        { status: 400 }
      );
    }

    if (!directory) {
      return NextResponse.json(
        { error: "Target directory is required" },
        { status: 400 }
      );
    }

    // Resolve ~ to home directory
    const resolvedDir = directory.replace(/^~/, process.env.HOME || "");

    // Verify parent directory exists
    try {
      await fs.access(resolvedDir);
    } catch {
      return NextResponse.json(
        { error: `Directory does not exist: ${directory}` },
        { status: 400 }
      );
    }

    // Extract repo name from URL for the clone target
    const repoName = extractRepoName(url);
    if (!repoName) {
      return NextResponse.json(
        { error: "Could not determine repository name from URL" },
        { status: 400 }
      );
    }

    const clonePath = path.join(resolvedDir, repoName);

    // Check if target already exists
    try {
      await fs.access(clonePath);
      return NextResponse.json(
        { error: `Directory already exists: ${clonePath}` },
        { status: 409 }
      );
    } catch {
      // Good - doesn't exist yet
    }

    // Clone the repository
    const { stderr } = await execAsync(`git clone "${url}" "${clonePath}"`, {
      timeout: 120000,
    });

    // git clone outputs progress to stderr, not an error
    if (stderr && stderr.includes("fatal:")) {
      return NextResponse.json({ error: stderr.trim() }, { status: 500 });
    }

    return NextResponse.json({
      path: clonePath,
      name: repoName,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to clone repository";
    console.error("Error cloning repository:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function extractRepoName(url: string): string | null {
  // https://github.com/user/repo.git or https://github.com/user/repo
  // git@github.com:user/repo.git
  const match = url.match(
    /(?:[\w.-]+\/([\w.-]+?)(?:\.git)?$|:([\w.-]+\/)([\w.-]+?)(?:\.git)?$)/
  );
  if (match) {
    return match[1] || match[3] || null;
  }
  return null;
}
