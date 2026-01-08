import { NextResponse } from "next/server";
import {
  getWorkerOutput,
  sendToWorker,
  completeWorker,
  failWorker,
  killWorker,
} from "@/lib/orchestration";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/orchestrate/workers/[id] - Get worker output
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const lines = parseInt(searchParams.get("lines") || "50", 10);

    const output = await getWorkerOutput(id, lines);
    return NextResponse.json({ output });
  } catch (error) {
    console.error("Failed to get worker output:", error);
    return NextResponse.json(
      { error: "Failed to get worker output" },
      { status: 500 }
    );
  }
}

// POST /api/orchestrate/workers/[id] - Send message or update status
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { action, message } = body;

    switch (action) {
      case "send":
        if (!message) {
          return NextResponse.json(
            { error: "Missing message" },
            { status: 400 }
          );
        }
        const sent = await sendToWorker(id, message);
        return NextResponse.json({ success: sent });

      case "complete":
        completeWorker(id);
        return NextResponse.json({ success: true });

      case "fail":
        failWorker(id);
        return NextResponse.json({ success: true });

      default:
        return NextResponse.json(
          { error: "Invalid action. Use: send, complete, or fail" },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Failed to perform worker action:", error);
    return NextResponse.json(
      { error: "Failed to perform worker action" },
      { status: 500 }
    );
  }
}

// DELETE /api/orchestrate/workers/[id] - Kill worker
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const cleanupWorktree = searchParams.get("cleanup") === "true";

    await killWorker(id, cleanupWorktree);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to kill worker:", error);
    return NextResponse.json(
      { error: "Failed to kill worker" },
      { status: 500 }
    );
  }
}
