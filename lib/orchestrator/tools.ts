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
    "Every session in this workspace: project, view, status, what it's doing, task/PR/CI state and stack position; then external sessions (tmux sessions AgentOS didn't start, here or on other machines, working in a workspace repository), read-only, with their branch's PR.",
  read: "The end of one session's terminal or chat, or an external session's screen, as plain text (capped at about 4k tokens).",
  cards: "Cards on this workspace's linked LumifyHub boards, by list.",
  send: "Message a session in this workspace over the bus. It arrives as its next prompt. When Saad changes a running task's scope, tell it with scope_change set, so its review judges the PR against the brief as amended.",
  orchestrators:
    "Every workspace, and whether it has an orchestrator you can message.",
  message_orchestrator:
    "Message another workspace's orchestrator, by workspace name; never any other session there. It arrives as its next prompt, marked as from you and fenced as untrusted.",
  start_task:
    "Start a task: an agent in its own worktree that ends in a PR. It runs as a chat unless view is terminal (only for a job that needs a TUI). With after (a task's id or name, or \"any\"), or over the workspace's running task limit, it's queued and starts by itself; the result says Queued (position N). Refused while a brake holds.",
  start_session:
    "Start an interactive agent session in a project with a prompt. It runs as a chat unless view is terminal (only for a job that needs a TUI). Refused while a brake holds.",
  stack:
    "Run a LumifyHub board's open cards as stacked tasks (each start braked), or with plan_only just show the plan.",
  stack_status: "One stack's items, PRs and progress.",
  land: "Merge a whole stack bottom-up, each PR through the sign-off gates at its current head.",
  drop: "Reject a task: close its PR and remove its worktree. Logged with the reason.",
  stop: "Stop a session's agent, keeping its worktree and branch.",
  done: "Finish a session whose work is complete: a task's open PR merges through the sign-off gates first (refused naming the failing gate), then its agent stops, its worktree is removed if nothing would be lost, and it's archived. Not a rejection.",
  note: "Add a line to this workspace's decision log; it shows in your chat.",
  review:
    "Start an independent read-only review of a PR at its exact head commit, or read the stored verdict for that commit. Takes a task, or any open PR in a workspace repository by #N, owner/repo#N or URL, even one no task owns.",
  sign_off:
    "Merge a PR, with its project's merge method, through the gates: CI green and settled, a passing review of that commit, nothing blocked, in scope, stack parent merged. Takes a task, or any open PR in a workspace repository by #N, owner/repo#N or URL (an external PR). Refuses with the failing gate, or a repository outside the workspace.",
  ask_saad:
    "Park an item on Saad's asks list (a decision, or anything crossing a hard line) and carry on; it never waits. One open ask per title. His answer reaches you as an event. To ask whether to merge a PR the gates refuse, give task and sha (its head): his approval lets sign_off merge it once, at that commit.",
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
