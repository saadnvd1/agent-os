import { NextRequest, NextResponse } from "next/server";
import { spawnSession, findProject } from "@/lib/agents/spawn";
import { createTask } from "@/lib/tasks";
import { startOrQueue, stampPriority } from "@/lib/tasks/queue";
import { isPriority } from "@/lib/tasks/schedule-types";
import { hostIdNamed } from "@/lib/hosts";
import { startView } from "@/lib/sessions/launch";
import { callerSession, starterOf } from "@/lib/tasks/starter";
import { callingDevice } from "@/lib/security/device-me";
import {
  findPiece,
  pieceLabel,
  pieceRefusal,
  waitingPiecesFor,
} from "@/lib/plans/claim";

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
      priority,
      machine,
      from,
      cwd,
      piece,
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
    if (mode === "task") {
      const projectId = findProject(String(project ?? "")).id;
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
    const session = await spawnSession({
      project: String(project ?? ""),
      prompt,
      name: given,
      model,
      startedBy,
      parentSessionId: starter.parentSessionId,
    });
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
