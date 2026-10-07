import { NextRequest, NextResponse } from "next/server";
import { createTask, listTasks } from "@/lib/tasks";

export async function GET() {
  return NextResponse.json({ tasks: await listTasks() });
}

export async function POST(request: NextRequest) {
  try {
    const { projectId, prompt, model, name, baseBranch } = await request.json();
    const session = await createTask({
      projectId,
      prompt,
      model,
      name: typeof name === "string" ? name : undefined,
      baseBranch:
        typeof baseBranch === "string" && baseBranch ? baseBranch : undefined,
    });
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
