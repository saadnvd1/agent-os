import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { discoveredModels } from "@/lib/chat/discovered-models";
import { getProject } from "@/lib/projects";

const query = z.object({
  agent: z.string().min(1),
  projectId: z.string().optional(),
  refresh: z.string().optional(),
});

// GET /api/discovered-models?agent=&projectId=&refresh=1 - the models an agent
// reports for a project's folder, for a draft that has no session yet. Empty
// for an agent with a fixed list.
export async function GET(request: NextRequest) {
  const parsed = query.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!parsed.success)
    return NextResponse.json({ error: "agent is required" }, { status: 400 });
  const { agent, projectId, refresh } = parsed.data;
  const folder = projectId ? getProject(projectId)?.working_directory : null;
  try {
    return NextResponse.json({
      models: await discoveredModels(agent, folder, refresh !== undefined),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Couldn't list the models: ${message}` },
      { status: 502 }
    );
  }
}
