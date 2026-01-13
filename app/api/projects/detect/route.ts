import { NextRequest, NextResponse } from "next/server";
import { detectDevServers, validateWorkingDirectory } from "@/lib/projects";

// POST /api/projects/detect - Detect available dev servers in a directory
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { workingDirectory } = body;

    if (!workingDirectory) {
      return NextResponse.json(
        { error: "Working directory is required" },
        { status: 400 }
      );
    }

    if (!validateWorkingDirectory(workingDirectory)) {
      return NextResponse.json(
        { error: "Working directory does not exist" },
        { status: 400 }
      );
    }

    const detected = await detectDevServers(workingDirectory);
    return NextResponse.json({ detected });
  } catch (error) {
    console.error("Error detecting dev servers:", error);
    return NextResponse.json(
      { error: "Failed to detect dev servers" },
      { status: 500 }
    );
  }
}
