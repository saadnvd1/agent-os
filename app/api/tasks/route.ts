import { parseOverride } from "@/lib/models/resolve";
import { NextRequest, NextResponse } from "next/server";
import { createTask, listTasks, movedTasks } from "@/lib/tasks";
import { stampPriority, startOrQueue } from "@/lib/tasks/queue";
import { isPriority } from "@/lib/tasks/schedule-types";
import { TASK_CAPABILITIES } from "@/lib/tasks/remote";
import { ensureProject, type ProjectRef } from "@/lib/tasks/project-ref";
import { callingDevice } from "@/lib/security/device-me";
import {
  isSessionId,
  statusFor,
  validateOrchestrated,
} from "@/lib/tasks/move-bundle";
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
      priority,
      machine,
      orchestrated,
    } = await request.json();
    if (id !== undefined && !isSessionId(id)) throw new Error("Bad task id");
    const pid =
      project && typeof project === "object"
        ? (await ensureProject(project as ProjectRef)).id
        : projectId;
    if (priority !== undefined && !isPriority(priority))
      throw new Error(
        "Priority is one of: urgent, blocking, normal, background"
      );
    if (machine !== undefined && machine !== "any" && machine !== "mac")
      throw new Error('Machine is "any" or "mac"');
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
      startedVia: "person" as const,
      startedByDevice: callingDevice(request) ?? undefined,
    };
    if (id !== undefined) {
      // An orchestrator's task is held for the paired device that sent it,
      // as a moved one is (lib/tasks/held.ts).
      const device = callingDevice(request);
      let held;
      if (orchestrated !== undefined) {
        if (!device)
          return NextResponse.json(
            {
              error: "An orchestrator's task comes only from a paired machine",
            },
            { status: 403 }
          );
        held = { device, orchestrated: validateOrchestrated(orchestrated) };
      }
      const session = await createTask({
        id,
        ...opts,
        held,
        startedVia: "remote",
        startedByDevice: device ?? undefined,
      });
      return NextResponse.json({ session }, { status: 201 });
    }
    const out = await startOrQueue(
      {
        ...opts,
        after: typeof after === "string" ? after : undefined,
        priority,
        machine,
      },
      () => createTask(opts)
    );
    if ("queued" in out)
      return NextResponse.json({ queued: out.queued }, { status: 202 });
    const session = out.started;
    stampPriority(session.id, priority);
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: statusFor(error) });
  }
}
