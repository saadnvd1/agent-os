import { NextResponse } from "next/server";
import { listQueue } from "@/lib/tasks/queue";

// Tasks waiting to start, in line order (lib/tasks/queue.ts).
export async function GET() {
  return NextResponse.json({ queue: listQueue() });
}
