import { NextRequest, NextResponse } from "next/server";
import { getCommitHistory } from "@/lib/git-history";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const path = searchParams.get("path");
    const limitStr = searchParams.get("limit");
    const limit = limitStr ? parseInt(limitStr, 10) : 30;

    if (!path) {
      return NextResponse.json(
        { error: "Missing path parameter" },
        { status: 400 }
      );
    }

    const commits = getCommitHistory(path, limit);
    return NextResponse.json({ commits });
  } catch (error) {
    console.error("Error getting commit history:", error);
    return NextResponse.json(
      { error: "Failed to get commit history" },
      { status: 500 }
    );
  }
}
