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
import { ORCHESTRATOR_SERVER } from "./tool-names";
import { TOOL_SHAPES, TOOLS, type ToolName } from "./tool-schemas";

type CallToolResult = Awaited<ReturnType<Parameters<typeof tool>[3]>>;

export type ToolCaller = (tool: ToolName, args: object) => Promise<string>;

export const TOKEN_HEADER = "x-agentos-orchestrator";

export function httpToolCaller(
  baseUrl: string,
  workspaceId: string,
  token: string
): ToolCaller {
  return async (name, args) => {
    const res = await fetch(
      `${baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/orchestrator/tools`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", [TOKEN_HEADER]: token },
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

const DESCRIPTIONS: Record<ToolName, string> = {
  sessions:
    "Every session in this workspace: project, view, status, what it's doing, task/PR/CI state and stack position.",
  read: "The end of one session's terminal or chat, as plain text (capped at about 4k tokens).",
  cards: "Cards on this workspace's linked LumifyHub boards, by list.",
  send: "Message a session in this workspace over the bus. It arrives as its next prompt.",
  start_task:
    "Start a task: an agent in its own worktree that ends in a PR. Refused while a brake holds.",
  start_session:
    "Start an interactive agent session in a project with a prompt. Refused while a brake holds.",
  stack:
    "Run a LumifyHub board's open cards as stacked tasks (each start braked), or with plan_only just show the plan.",
  stack_status: "One stack's items, PRs and progress.",
  land: "Merge a whole stack bottom-up, each PR through the sign-off gates at its current head.",
  drop: "Reject a task: close its PR and remove its worktree. Logged with the reason.",
  stop: "Stop a session's agent, keeping its worktree and branch.",
  done: "Finish a session whose work is complete: a task's open PR merges through the sign-off gates first (refused naming the failing gate), then its agent stops, its worktree is removed if nothing would be lost, and it's archived. Not a rejection.",
  note: "Add a line to this workspace's decision log; it shows in your chat.",
  review:
    "Start an independent read-only review of a task's PR at its exact head commit, or read the stored verdict for that commit.",
  sign_off:
    "Squash-merge a task's PR through the gates: CI green and settled, a passing review of that commit, nothing blocked, in scope, stack parent merged. Refuses with the failing gate.",
  ask_saad:
    "Park an item on Saad's asks list (a decision, or anything crossing a hard line) and carry on; it never waits. One open ask per title. His answer reaches you as an event.",
};

export function orchestratorTools(
  call: ToolCaller
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: ORCHESTRATOR_SERVER,
    version: "1.0.0",
    tools: TOOLS.map((name) =>
      tool(name, DESCRIPTIONS[name], TOOL_SHAPES[name], (args: object) =>
        answer(call(name, args))
      )
    ),
  });
}
