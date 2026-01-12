import { NextRequest, NextResponse } from "next/server";
import { listDirectory } from "@/lib/files";

/**
 * GET /api/files?path=...&recursive=true
 * List directory contents
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const path = searchParams.get("path");
    const recursive = searchParams.get("recursive") === "true";

    if (!path) {
      return NextResponse.json(
        { error: "Path parameter is required" },
        { status: 400 }
      );
    }

    // Expand ~ to home directory
    const expandedPath = path.replace(/^~/, process.env.HOME || "");

    const files = listDirectory(expandedPath, {
      recursive,
      maxDepth: recursive ? 2 : 1,
    });

    return NextResponse.json({ files, path: expandedPath });
  } catch (error) {
    console.error("Error listing directory:", error);
    return NextResponse.json(
      { error: "Failed to list directory" },
      { status: 500 }
    );
  }
}
