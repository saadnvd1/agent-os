/**
 * The orchestrator chat's tools, as an in-process MCP server in its chat
 * worker. Each one asks the AgentOS server, which holds the live state
 * (chat activity, status, tasks) and enforces the workspace scope, brakes
 * and gates, and returns its text as is.
 */

import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ToolArgs, ToolName } from "./serve";
import { ORCHESTRATOR_SERVER } from "./tool-names";
import { actingTools } from "./tools-act";

type CallToolResult = Awaited<ReturnType<Parameters<typeof tool>[3]>>;

export type ToolCaller = (tool: ToolName, args: ToolArgs) => Promise<string>;

export function httpToolCaller(
  baseUrl: string,
  workspaceId: string
): ToolCaller {
  return async (name, args) => {
    const res = await fetch(
      `${baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/orchestrator/tools`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: name, args }),
      }
    );
    const text = await res.text();
    if (!res.ok) throw new Error(text || `AgentOS answered ${res.status}`);
    return text;
  };
}

const answer = async (call: Promise<string>): Promise<CallToolResult> => {
  try {
    return { content: [{ type: "text", text: await call }] };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text }], isError: true };
  }
};

export function orchestratorTools(
  call: ToolCaller
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: ORCHESTRATOR_SERVER,
    version: "1.0.0",
    tools: [
      tool(
        "sessions",
        "Every session in this workspace: project, view, status, what it's doing, task/PR/CI state and stack position.",
        {},
        () => answer(call("sessions", {}))
      ),
      tool(
        "read",
        "The end of one session's terminal or chat, as plain text (capped at about 4k tokens).",
        {
          session: z
            .string()
            .describe("Session name, project/name, or id from sessions"),
          lines: z
            .number()
            .int()
            .min(1)
            .max(400)
            .optional()
            .describe("How many lines from the end (default 60)"),
        },
        (args) => answer(call("read", args))
      ),
      tool(
        "cards",
        "Cards on this workspace's linked LumifyHub boards, by list.",
        {
          board: z
            .string()
            .optional()
            .describe("One board, by board or project name"),
        },
        (args) => answer(call("cards", args))
      ),
      ...actingTools((name, args) => answer(call(name, args))),
    ],
  });
}
