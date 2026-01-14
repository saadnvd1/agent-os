import { NextRequest, NextResponse } from "next/server";
import { getCommitDetail } from "@/lib/git-history";

interface RouteParams {
  params: Promise<{ hash: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { hash } = await params;
    const searchParams = request.nextUrl.searchParams;
    const path = searchParams.get("path");

    if (!path) {
      return NextResponse.json(
        { error: "Missing path parameter" },
        { status: 400 }
      );
    }

    const commit = getCommitDetail(path, hash);
    if (!commit) {
      return NextResponse.json({ error: "Commit not found" }, { status: 404 });
    }

    return NextResponse.json({ commit });
  } catch (error) {
    console.error("Error getting commit detail:", error);
    return NextResponse.json(
      { error: "Failed to get commit detail" },
      { status: 500 }
    );
  }
}
