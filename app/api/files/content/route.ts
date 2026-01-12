import { NextRequest, NextResponse } from "next/server";
import { readFileContent } from "@/lib/files";

/**
 * GET /api/files/content?path=...
 * Read file contents
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const path = searchParams.get("path");

    if (!path) {
      return NextResponse.json(
        { error: "Path parameter is required" },
        { status: 400 }
      );
    }

    // Expand ~ to home directory
    const expandedPath = path.replace(/^~/, process.env.HOME || "");

    const result = readFileContent(expandedPath);

    return NextResponse.json({
      ...result,
      path: expandedPath,
    });
  } catch (error) {
    console.error("Error reading file:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read file" },
      { status: 500 }
    );
  }
}
