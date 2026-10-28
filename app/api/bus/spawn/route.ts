import { NextRequest, NextResponse } from "next/server";
import { spawnSession, findProject } from "@/lib/agents/spawn";
import { createTask } from "@/lib/tasks";
import { startOrQueue, stampPriority } from "@/lib/tasks/queue";
import { isPriority } from "@/lib/tasks/schedule-types";
import { hostIdNamed } from "@/lib/hosts";
import { resolveGroup } from "@/lib/session-groups";
import { launchSession, startView } from "@/lib/sessions/launch";
import { isAgentRole } from "@/lib/models/agent-roles";
import { callerSession, starterOf } from "@/lib/tasks/starter";
import { callingDevice } from "@/lib/security/device-me";
import {
  findPiece,
  pieceLabel,
  pieceRefusal,
  waitingPiecesFor,
} from "@/lib/plans/claim";

// mode "session" starts an interactive agent (a chat unless view is "terminal"); "task" starts one that ends in
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
      priority,
      machine,
      from,
      cwd,
      piece,
      group,
      agentRole,
    } = await request.json();
    // Whoever called: a session (by `from`, else the worktree it runs in) or a person.
    const starter = starterOf(
      callerSession({ from, cwd }),
      callingDevice(request)
    );
    const { startedBy } = starter;
    const given = typeof name === "string" ? name : undefined;
    if (after !== undefined && mode !== "task")
      throw new Error("--after works for tasks only");
    if (planOnly !== undefined && mode !== "task")
      throw new Error("--plan-only works for tasks only");
    if ((priority !== undefined || machine !== undefined) && mode !== "task")
      throw new Error("--priority and --on-mac work for tasks only");
    if (priority !== undefined && !isPriority(priority))
      throw new Error("--priority is urgent, blocking, normal or background");
    if (machine !== undefined && machine !== "mac" && machine !== "any")
      throw new Error('machine is "mac" or "any"');
    if (piece !== undefined && mode !== "task")
      throw new Error("--piece works for tasks only");
    const target = findProject(String(project ?? ""));
    if (group !== undefined && (typeof group !== "string" || !group.trim()))
      throw new Error("--group needs a group name");
    const groupId =
      typeof group === "string"
        ? resolveGroup(target.workspace_id ?? null, group).id
        : undefined;
    if (mode === "task") {
      const projectId = target.id;
      // A task whose plan has pieces waiting here must say which it builds.
      const waiting = startedBy ? waitingPiecesFor(startedBy, projectId) : [];
      let pieceId: number | undefined;
      if (piece !== undefined) {
        if (typeof piece !== "string" || !piece.trim())
          throw new Error("--piece needs a piece name");
        pieceId = findPiece(waiting, piece).id;
      } else if (waiting.length)
        throw new Error(pieceRefusal(waiting, projectId));
      const task = {
        projectId,
        ...starter,
        pieceId,
        prompt: String(prompt ?? ""),
        name: given,
        model,
        hostId: on ? hostIdNamed(String(on)) : undefined,
        view: startView(view),
        groupId,
        planOnly: planOnly === true ? true : undefined,
      };
      const out = await startOrQueue(
        {
          ...task,
          after: typeof after === "string" ? after : undefined,
          priority,
          machine,
        },
        async () => {
          const session = await createTask(task);
          stampPriority(session.id, priority);
          return session;
        }
      );
      const builds = pieceId ? pieceLabel(pieceId) : undefined;
      return "queued" in out
        ? NextResponse.json({ queued: out.queued, builds }, { status: 202 })
        : NextResponse.json({ session: out.started, builds }, { status: 201 });
    }
    if (agentRole !== undefined) {
      if (!isAgentRole(agentRole))
        throw new Error("--role is developer, analyst, reviewer or supervisor");
      if (startView(view) === "terminal")
        throw new Error("--terminal doesn't work with --role");
    }
    // A terminal session is typed its first prompt in tmux; anything else
    // opens as a chat (the default view).
    if (startView(view) === "terminal") {
      const session = await spawnSession({
        project: String(project ?? ""),
        prompt,
        name: given,
        model,
        startedBy,
        parentSessionId: starter.parentSessionId,
        groupId,
      });
      return NextResponse.json({ session }, { status: 201 });
    }
    if (typeof prompt !== "string" || !prompt.trim())
      throw new Error("Give the new session a prompt");
    if (target.is_uncategorized) throw new Error("Pick a real project");
    const { session } = await launchSession({
      projectId: target.id,
      agentType: "claude",
      prompt,
      name: given,
      model: typeof model === "string" ? model : null,
      autoApprove: true,
      startedBy,
      startedVia: starter.startedVia,
      parentSessionId: starter.parentSessionId,
      groupId,
      agentRole,
    });
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
