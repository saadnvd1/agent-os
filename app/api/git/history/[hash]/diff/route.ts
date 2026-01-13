import { NextRequest, NextResponse } from "next/server";
import { getCommitFileDiff } from "@/lib/git-history";

interface RouteParams {
  params: Promise<{ hash: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { hash } = await params;
    const searchParams = request.nextUrl.searchParams;
    const path = searchParams.get("path");
    const file = searchParams.get("file");

    if (!path) {
      return NextResponse.json(
        { error: "Missing path parameter" },
        { status: 400 }
      );
    }

    if (!file) {
      return NextResponse.json(
        { error: "Missing file parameter" },
        { status: 400 }
      );
    }

    const diff = getCommitFileDiff(path, hash, file);
    return NextResponse.json({ diff });
  } catch (error) {
    console.error("Error getting commit file diff:", error);
    return NextResponse.json(
      { error: "Failed to get commit file diff" },
      { status: 500 }
    );
  }
}
