import { NextRequest, NextResponse } from "next/server";
import { listFolders } from "@/lib/project-add";

// GET /api/projects/browse?hostId=&path= - a folder's subfolders on any
// machine, for picking a project.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  try {
    const listing = await listFolders(
      q.get("hostId") || "local",
      q.get("path") || "~"
    );
    return NextResponse.json(listing);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: message.split("\n").pop() || "Couldn't open that folder" },
      { status: 400 }
    );
  }
}
