import type { NextRequest } from "next/server";
import { body, respond } from "@/lib/lumifyhub/http";
import { lumifyHubId } from "@/lib/lumifyhub/ids";
import { cardForTask, promptFromCard } from "@/lib/lumifyhub/task-cards";
import { createTask } from "@/lib/tasks";

type RouteParams = { params: Promise<{ cardId: string }> };

// Start a task from a board card; the card then moves like any other.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { cardId } = await params;
  const { projectId } = await body<{ projectId: string }>(request);
  return respond(async () => {
    const { project, card } = await cardForTask(
      projectId ?? "",
      lumifyHubId(cardId, "card id")
    );
    const session = await createTask({
      projectId: project.id,
      prompt: promptFromCard(card),
      cardId: card.id,
    });
    return { session };
  });
}
