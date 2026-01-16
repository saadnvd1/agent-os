import { NextRequest, NextResponse } from "next/server";
import { searchCode, formatSearchResults } from "@/lib/code-search";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const query = searchParams.get("query");
    const path = searchParams.get("path");
    const maxResults = parseInt(searchParams.get("maxResults") || "100");
    const contextLines = parseInt(searchParams.get("contextLines") || "2");

    if (!query) {
      return NextResponse.json(
        { error: "Query parameter is required" },
        { status: 400 }
      );
    }

    if (!path) {
      return NextResponse.json(
        { error: "Path parameter is required" },
        { status: 400 }
      );
    }

    const expandedPath = path.replace(/^~/, process.env.HOME || "");

    const rawMatches = searchCode(expandedPath, query, {
      maxResults,
      contextLines,
    });

    const results = formatSearchResults(rawMatches);

    return NextResponse.json({
      results,
      query,
      path: expandedPath,
      count: results.length,
    });
  } catch (error) {
    console.error("Code search error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to search code";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
