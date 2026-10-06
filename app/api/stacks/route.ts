import type { NextRequest } from "next/server";
import { body, respond } from "@/lib/lumifyhub/http";
import { findProject } from "@/lib/agents/spawn";
import { listStacks, previewStack, startStack } from "@/lib/stacks";

export async function GET() {
  return respond(() => ({ stacks: listStacks() }));
}

// Run a project's linked board as a stack; `dryRun` returns the plan only.
// `project` is a name or id (aos), `projectId` an id (the UI).
export async function POST(request: NextRequest) {
  const input = await body<{
    projectId: string;
    project: string;
    dryRun: boolean;
    maxParallel: number;
  }>(request);
  return respond(async () => {
    const projectId = findProject(
      String(input.projectId ?? input.project ?? "")
    ).id;
    return input.dryRun
      ? { preview: await previewStack(projectId) }
      : {
          stack: await startStack({
            projectId,
            maxParallel: input.maxParallel,
          }),
        };
  });
}
