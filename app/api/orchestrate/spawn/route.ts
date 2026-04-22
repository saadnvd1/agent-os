import { NextResponse } from "next/server";
import { resolveModelForAgent } from "@/lib/model-catalog";
import { isValidAgentType, type AgentType } from "@/lib/providers";
import { spawnWorker } from "@/lib/orchestration";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      conductorSessionId,
      task,
      workingDirectory,
      branchName,
      useWorktree = true,
      model,
      agentType: rawAgentType = "claude",
    } = body;
    const agentType: AgentType = isValidAgentType(rawAgentType)
      ? rawAgentType
      : "claude";
    const resolvedModel = resolveModelForAgent(
      agentType,
      typeof model === "string" ? model.trim() : model
    );

    if (!conductorSessionId || !task || !workingDirectory) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: conductorSessionId, task, workingDirectory",
        },
        { status: 400 }
      );
    }

    const session = await spawnWorker({
      conductorSessionId,
      task,
      workingDirectory,
      branchName,
      useWorktree,
      model: resolvedModel,
      agentType,
    });

    return NextResponse.json({ session });
  } catch (error) {
    console.error("Failed to spawn worker:", error);
    return NextResponse.json(
      { error: "Failed to spawn worker" },
      { status: 500 }
    );
  }
}
