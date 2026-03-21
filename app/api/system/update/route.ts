import { NextResponse } from "next/server";
import { spawn } from "child_process";

export async function POST() {
  try {
    const child = spawn("agent-os", ["update"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    child.unref();

    return NextResponse.json({ started: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to start update" },
      { status: 500 }
    );
  }
}
