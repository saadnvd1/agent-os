import { NextRequest, NextResponse } from "next/server";
import { tmux } from "@/lib/tmux/exec";

// POST /api/tmux/rename - Rename a tmux session
export async function POST(request: NextRequest) {
  try {
    const { oldName, newName } = await request.json();

    if (
      !oldName ||
      !newName ||
      typeof oldName !== "string" ||
      typeof newName !== "string"
    ) {
      return NextResponse.json(
        { error: "oldName and newName are required" },
        { status: 400 }
      );
    }

    // Rename the tmux session
    await tmux(["rename-session", "-t", `=${oldName}`, "--", newName]);

    return NextResponse.json({ success: true, newName });
  } catch (error) {
    console.error("Error renaming tmux session:", error);
    return NextResponse.json(
      { error: "Failed to rename tmux session" },
      { status: 500 }
    );
  }
}
