import { getWorkspace } from "../workspaces";
import { readCards } from "./cards";
import { describeSessions } from "./describe";
import { sessionFacts } from "./facts";
import { readSession } from "./read";

export type ToolName = "sessions" | "read" | "cards";

export interface ToolArgs {
  session?: string;
  lines?: number;
  board?: string;
}

// The orchestrator's read-only tools, answered as compact text.
export async function runTool(
  workspaceId: string,
  tool: ToolName,
  args: ToolArgs = {}
): Promise<string> {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) throw new Error("Unknown workspace");
  switch (tool) {
    case "sessions":
      return describeSessions(workspace.name, await sessionFacts(workspaceId));
    case "read":
      if (!args.session) throw new Error("Say which session to read");
      return readSession(workspaceId, args.session, args.lines);
    case "cards":
      return readCards(workspaceId, args.board);
  }
}

export const isToolName = (t: unknown): t is ToolName =>
  t === "sessions" || t === "read" || t === "cards";
