import { NextRequest, NextResponse } from "next/server";
import { spawnSession, findProject } from "@/lib/agents/spawn";
import { createTask } from "@/lib/tasks";
import { queueIfNeeded } from "@/lib/tasks/queue";
import { hostIdNamed } from "@/lib/hosts";

// mode "session" starts an interactive agent; "task" starts one that ends in
// a PR, or queues it (over the workspace's limit, or with `after`).
export async function POST(request: NextRequest) {
  try {
    const {
      project,
      prompt,
      mode = "session",
      model,
      name,
      on,
      after,
    } = await request.json();
    const given = typeof name === "string" ? name : undefined;
    if (after !== undefined && mode !== "task")
      throw new Error("--after works for tasks only");
    if (mode === "task") {
      const task = {
        projectId: findProject(String(project ?? "")).id,
        prompt: String(prompt ?? ""),
        name: given,
        model,
        hostId: on ? hostIdNamed(String(on)) : undefined,
      };
      const queued = queueIfNeeded({
        ...task,
        after: typeof after === "string" ? after : undefined,
      });
      if (queued) return NextResponse.json({ queued }, { status: 202 });
      return NextResponse.json(
        { session: await createTask(task) },
        { status: 201 }
      );
    }
    const session = await spawnSession({
      project: String(project ?? ""),
      prompt,
      name: given,
      model,
    });
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
