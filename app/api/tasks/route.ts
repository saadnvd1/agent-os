import { NextRequest, NextResponse } from "next/server";
import { createTask, listTasks } from "@/lib/tasks";
import { getProject } from "@/lib/projects";

export async function GET() {
  return NextResponse.json({ tasks: await listTasks() });
}

export async function POST(request: NextRequest) {
  try {
    const { projectId, prompt, model, name, baseBranch, hostId } =
      await request.json();
    // Another machine's AgentOS runs a task once remote tasks land; until
    // then, say so rather than run it here.
    const home = getProject(String(projectId))?.host_id || "local";
    if (typeof hostId === "string" && hostId && hostId !== home)
      return NextResponse.json(
        { error: "Tasks run where their project lives for now" },
        { status: 400 }
      );
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
