import { NextRequest, NextResponse } from "next/server";
import { spawnSession, findProject } from "@/lib/agents/spawn";
import { createTask } from "@/lib/tasks";
import { startOrQueue } from "@/lib/tasks/queue";
import { hostIdNamed } from "@/lib/hosts";
import { startView } from "@/lib/sessions/launch";
import { db } from "@/lib/db";

// The calling session, when it's an orchestrator: what it starts runs on the
// implementation model. A made-up `from` can only pick that cheaper role.
function orchestratorFrom(from: unknown): string | null {
  if (typeof from !== "string" || !from) return null;
  const row = db
    .prepare(`SELECT 1 FROM sessions WHERE id = ? AND role = 'orchestrator'`)
    .get(from);
  return row ? from : null;
}

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
      view,
      planOnly,
      from,
    } = await request.json();
    const startedBy = orchestratorFrom(from);
    const given = typeof name === "string" ? name : undefined;
    if (after !== undefined && mode !== "task")
      throw new Error("--after works for tasks only");
    if (planOnly !== undefined && mode !== "task")
      throw new Error("--plan-only works for tasks only");
    if (mode === "task") {
      const task = {
        projectId: findProject(String(project ?? "")).id,
        prompt: String(prompt ?? ""),
        name: given,
        model,
        hostId: on ? hostIdNamed(String(on)) : undefined,
        view: startView(view),
        planOnly: planOnly === true ? true : undefined,
        startedBy,
      };
      const out = await startOrQueue(
        { ...task, after: typeof after === "string" ? after : undefined },
        () => createTask(task)
      );
      return "queued" in out
        ? NextResponse.json({ queued: out.queued }, { status: 202 })
        : NextResponse.json({ session: out.started }, { status: 201 });
    }
    const session = await spawnSession({
      project: String(project ?? ""),
      prompt,
      name: given,
      model,
      startedBy,
    });
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
