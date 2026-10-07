import { NextRequest, NextResponse } from "next/server";
import { spawnSession, findProject } from "@/lib/agents/spawn";
import { createTask } from "@/lib/tasks";
import { hostIdNamed } from "@/lib/hosts";

// mode "session" starts an interactive agent; "task" starts one that ends in a PR.
export async function POST(request: NextRequest) {
  try {
    const {
      project,
      prompt,
      mode = "session",
      model,
      name,
      on,
    } = await request.json();
    const given = typeof name === "string" ? name : undefined;
    const session =
      mode === "task"
        ? await createTask({
            projectId: findProject(String(project ?? "")).id,
            prompt,
            name: given,
            model,
            hostId: on ? hostIdNamed(String(on)) : undefined,
          })
        : await spawnSession({
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
