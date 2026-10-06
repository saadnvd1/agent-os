// The orchestrator's acting tools as MCP definitions. Each forwards to the
// AgentOS server, which scopes it to the workspace and applies the brakes
// and gates.

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ToolArgs, ToolName } from "./serve";

type CallToolResult = Awaited<ReturnType<Parameters<typeof tool>[3]>>;
type Answer = (name: ToolName, args: ToolArgs) => Promise<CallToolResult>;

const session = z
  .string()
  .describe("Session name, project/name, or id from sessions");
const task = z
  .string()
  .describe("Task name, project/name, id, or its PR (#12)");
const project = z.string().describe("A project of this workspace, by name");
const stackId = z
  .string()
  .describe("Stack id (or its name) from stack or sessions");

export function actingTools(answer: Answer) {
  return [
    tool(
      "send",
      "Message a session in this workspace over the bus. It arrives as its next prompt.",
      { session, message: z.string() },
      (args) => answer("send", args)
    ),
    tool(
      "start_task",
      "Start a task: an agent in its own worktree that ends in a PR. Refused while a brake holds.",
      {
        project,
        prompt: z.string().describe("What to build, as a full brief"),
        base: z
          .string()
          .optional()
          .describe(
            "Branch to cut from (default: the project's default branch)"
          ),
      },
      (args) => answer("start_task", args)
    ),
    tool(
      "start_session",
      "Start an interactive agent session in a project with a prompt. Refused while a brake holds.",
      { project, prompt: z.string() },
      (args) => answer("start_session", args)
    ),
    tool(
      "stack",
      "Run a LumifyHub board's open cards as stacked tasks, or with plan_only just show the plan.",
      {
        target: z.string().describe("Board or project name"),
        plan_only: z.boolean().optional(),
      },
      (args) => answer("stack", args)
    ),
    tool(
      "stack_status",
      "One stack's items, PRs and progress.",
      { id: stackId },
      (args) => answer("stack_status", args)
    ),
    tool(
      "land",
      "Merge a whole stack bottom-up, only if every open item passes the sign-off gates now.",
      { id: stackId },
      (args) => answer("land", args)
    ),
    tool(
      "drop",
      "Reject a task: close its PR and remove its worktree. Logged with the reason.",
      { task, reason: z.string() },
      (args) => answer("drop", args)
    ),
    tool(
      "stop",
      "Stop a session's agent, keeping its worktree and branch.",
      { session },
      (args) => answer("stop", args)
    ),
    tool(
      "note",
      "Add a line to this workspace's decision log; it shows in your chat.",
      { text: z.string() },
      (args) => answer("note", args)
    ),
    tool(
      "review",
      "Start an independent read-only review of a task's PR at its exact head commit, or read the stored verdict for that commit.",
      {
        target: z.string().describe("The task, or its PR (#12 or URL)"),
        fresh: z
          .boolean()
          .optional()
          .describe("Run it again even if this commit has a verdict"),
      },
      (args) => answer("review", args)
    ),
    tool(
      "sign_off",
      "Squash-merge a task's PR through the gates: CI green, a passing review of that commit, nothing blocked, in scope, stack parent merged. Refuses with the failing gate.",
      { task },
      (args) => answer("sign_off", args)
    ),
  ];
}
