import { parseOverride } from "@/lib/models/resolve";
import { NextRequest, NextResponse } from "next/server";
import { createTask, listTasks, movedTasks } from "@/lib/tasks";
import { startOrQueue } from "@/lib/tasks/queue";
import { TASK_CAPABILITIES } from "@/lib/tasks/remote";
import { ensureProject, type ProjectRef } from "@/lib/tasks/project-ref";
import { isSessionId, statusFor } from "@/lib/tasks/move-bundle";
import { startView } from "@/lib/sessions/launch";
import { isValidAgentType } from "@/lib/providers";
import { isAgentModelName } from "@/lib/providers/registry";

// moved and capabilities are for another machine that mirrors these tasks.
export async function GET() {
  return NextResponse.json({
    tasks: await listTasks(),
    moved: movedTasks(),
    capabilities: TASK_CAPABILITIES,
  });
}

// projectId names a project here; project (a ref) is how another machine's
// AgentOS names one, found or cloned here, and id is its key for a retry.
// Over the workspace's running task limit, or with `after` (a task's id or
// name, or "any"), it's queued instead: { queued } with 202. Another
// machine's keyed start (id) is never queued; its caller wants the task.
export async function POST(request: NextRequest) {
  try {
    const {
      id,
      projectId,
      project,
      prompt,
      model,
      name,
      hostId,
      baseBranch,
      after,
      view,
      agent,
      plan,
      plan_reason,
      plan_only,
    } = await request.json();
    if (id !== undefined && !isSessionId(id)) throw new Error("Bad task id");
    const pid =
      project && typeof project === "object"
        ? (await ensureProject(project as ProjectRef)).id
        : projectId;
    if (agent !== undefined && !isValidAgentType(agent))
      throw new Error("Unknown agent");
    if (agent && agent !== "claude" && model != null && model !== "")
      if (!isAgentModelName(model)) throw new Error("Bad model name");
    const opts = {
      projectId: pid,
      prompt: String(prompt ?? ""),
      agent: agent && agent !== "claude" ? agent : undefined,
      // Checked now, so a queued task can't fail on it later. Another
      // agent's model is its own name for one.
      model:
        agent && agent !== "claude" && typeof model === "string"
          ? model
          : (parseOverride(model) ?? undefined),
      plan: typeof plan === "boolean" ? plan : undefined,
      planOnly: plan_only === true ? true : undefined,
      planReason:
        typeof plan_reason === "string" && plan_reason.trim()
          ? plan_reason.trim().slice(0, 200)
          : undefined,
      name: typeof name === "string" ? name : undefined,
      hostId: typeof hostId === "string" && hostId ? hostId : undefined,
      baseBranch: typeof baseBranch === "string" ? baseBranch : undefined,
      view: startView(view),
    };
    if (id !== undefined) {
      const session = await createTask({ id, ...opts });
      return NextResponse.json({ session }, { status: 201 });
    }
    const out = await startOrQueue(
      { ...opts, after: typeof after === "string" ? after : undefined },
      () => createTask(opts)
    );
    if ("queued" in out)
      return NextResponse.json({ queued: out.queued }, { status: 202 });
    const session = out.started;
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: statusFor(error) });
  }
}
