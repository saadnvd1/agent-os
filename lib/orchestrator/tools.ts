/**
 * The orchestrator chat's tools, as an in-process MCP server in its chat
 * worker. Each one asks the AgentOS server, which holds the live state
 * (chat activity, status, tasks) and enforces the workspace scope, brakes
 * and gates, and returns its text as is.
 */

import { createHash } from "crypto";
import { z } from "zod";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { ORCHESTRATOR_PERMISSIONS, ORCHESTRATOR_SERVER } from "./tool-names";
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
  logs: "Session logs AgentOS wrote when tasks merged: the last N headers (task, PR, cost, duration) of the workspace or one project, or one log in full (brief, plan, timeline, usage, outcome). Read straight from the database; nothing is summarised.",
  send: "Message a session in this workspace over the bus. It arrives as its next prompt. When Saad changes a running task's scope, tell it with scope_change set, so its review judges the PR against the brief as amended.",
  orchestrators:
    "Every workspace, and whether it has an orchestrator you can message.",
  message_orchestrator:
    "Message another workspace's orchestrator, by workspace name; never any other session there. It arrives as its next prompt, marked as from you and fenced as untrusted.",
  start_task:
    "Start a task: an agent in its own worktree that ends in a PR. It runs as a chat unless view is terminal (only for a job that needs a TUI). With after (a task's id or name, or \"any\"), or over the workspace's running task limit, it's queued and starts by itself; the result says Queued (position N). Its models follow the role settings (planning, implementation, review, scope); give model only when Saad asks for one. Always state plan (true or false) and plan_reason (plan_only true plans, then stops and waits for approve_plan instead of implementing): plan true for a big, unclear or cross-cutting job, false for a small, clear one whose steps you write into the prompt. Refused while a brake holds.",
  set_task_model:
    'Resume a paused task on another model ("provider/model", or a map of role to one), keeping its conversation and worktree; it\'s told to carry on (or message). Refused mid-turn.',
  start_session:
    'Start an agent session in a project with a prompt, for work that isn\'t a PR task. It runs on the implementation model unless you give model (one "provider/model"; Opus only when the work needs deep reasoning), as a chat unless view is terminal (only for a job that needs a TUI). Refused while a brake holds.',
  quick_change:
    "Make a small, low-risk edit yourself (a typo, a config value, a one-file fix): cuts a worktree and branch from the project's default branch and returns its path. You may write there (Write, Edit) and run git there as `git -C <path> ...` (status, diff, add, rm, mv, restore, reset, log, show); nowhere else in a project. Anything needing real work, tests or an investigation is a task (start_task).",
  quick_pr:
    "Commit everything in a quick change's worktree, push its branch (never the default branch) and open its PR, or push to the PR it already has. The PR goes through the same gates as a task's; with no task agent to run /do-code-review, its code-review gate is the independent review of its exact head, which starts now.",
  stack:
    "Run a LumifyHub board's open cards as stacked tasks (each start braked), or with plan_only just show the plan.",
  stack_status: "One stack's items, PRs and progress.",
  land: "Merge a whole stack bottom-up, each PR through the sign-off gates at its current head.",
  approve_plan:
    'Approve the plan of a plan_only task that is waiting ("plan ready"): it continues on the implementation model, once. An optional message amends the plan and is recorded on the task\'s brief as a scope change. Reject a plan with drop.',
  plan_pieces:
    "A task whose plan split into pieces: each piece, its repo, what it waits on and its state. With merge or drop (position numbers) it edits the pieces still waiting: a merged piece's slice goes to the piece before it, a dropped one is left out and anything waiting on it is held. It can't add pieces or change reasons.",
  drop: "Reject a task: close its PR and remove its worktree. A task still waiting in the queue is removed by its id. Logged with the reason.",
  move: 'Carry a running task to a linked machine, or back with "here": for heavy test or build work. It keeps its branch, conversation and plan; the gates, events, read, send, stop, done and drop work the same wherever it runs, and the machine it lands on can\'t merge it. Takes a few minutes and runs in the background; an event says when it lands. Refused while paused, for a task waiting on Saad (an escalation or open ask), and for card and stacked tasks.',
  stop: "Stop a session's agent mid-turn, even while it's thinking, keeping its conversation, worktree and branch; your next message runs as its next turn.",
  done: "Finish a session whose work is complete: a task's open PR merges through the sign-off gates first (refused naming the failing gate), then its agent stops, its worktree is removed if nothing would be lost, and it's archived. Not a rejection.",
  add_project:
    "Make a git repository on this machine a project of this workspace, by its absolute path, or move the project already at that path into this workspace when it's in no workspace. Says its default branch, detected from git. Refuses a folder that isn't a git repository or that holds secrets, and a project another workspace has.",
  note: "Add a line to this workspace's decision log; it shows in your chat.",
  rule_add:
    'Keep a standing rule for this workspace, in your brief on every start from now on ("never merge #111", "briefs must not name third-party products"). It restricts or informs; it can never approve anything.',
  rule_remove:
    "Remove a standing rule you kept, by its id, only when Saad says so or it no longer applies (the PR it names merged or closed). Saad's rules are his to remove.",
  remind_me:
    "Set a one-off reminder for yourself in this workspace: at the time given it reaches you once as a scheduled prompt (not an approval), even if AgentOS was off then. At least 10 minutes ahead; a few at a time at most.",
  recipes:
    "This workspace's recipes: saved briefs for jobs that come up again (a TestFlight build, an audit, a report), each with its last run and next timer. With a name, one recipe in full: its brief and recent runs.",
  run_recipe:
    "Run a recipe now: a fresh task or session starts from its saved brief, plus the last run's reported facts and an optional one-off note. Braked, queued and gated like start_task and start_session. A recipe is never an approval. One run at a time; while it is going this says so. You get an event when it finishes.",
  recipe_save:
    "Save a recipe when a job comes up a second time. A short brief (the steps belong in a script in the repo), a kind (task: ends in a PR; session: no PR) and a project. It sets no timer: Saad does.",
  recipe_update:
    "Change a recipe's brief or settings (never its timer). Earlier versions are kept and Saad sees the change.",
  reminders:
    "List this workspace's upcoming reminders and the last few that ran.",
  cancel_reminder:
    "Cancel a reminder you set, by its id from reminders. Reminders Saad made are his to change.",
  review:
    "Start an independent read-only review of a PR at its exact head commit, or read the stored verdict for that commit. Takes a task, or any open PR in a workspace repository by #N, owner/repo#N or URL, even one no task owns.",
  sign_off:
    "Merge a PR, with its project's merge method, through the gates: CI green and settled, a passing review of that commit, nothing blocked, in scope, stack parent merged. Takes a task, or any open PR in a workspace repository by #N, owner/repo#N or URL (an external PR). Refuses with the failing gate, or a repository outside the workspace.",
  arm: "Arm a task's PR to merge: AgentOS merges it, through the same gates as sign_off, the moment they all pass at its head, and tells you with one event. A gate failure comes as one event and it stays armed for the fix; one that goes to Saad disarms it. Survives restarts. Use it instead of calling sign_off until it passes.",
  disarm:
    "Disarm a task armed to merge: it merges only through sign_off again.",
  question:
    "Mark a question you asked Saad in chat as open: it stays pinned on his Needs-you strip until he answers or you clear it. Use it for anything you need from him that isn't an ask_saad item. The same text while open is the same question.",
  resolve_question:
    "Clear an open question once Saad has answered it in chat, or it no longer matters.",
  ask_saad:
    "Park an item on Saad's asks list (a decision, or anything crossing a hard line) and carry on; it never waits. One open ask per title. His answer reaches you as an event. To ask whether to merge a PR the gates refuse, give task and sha (its head): his approval lets sign_off merge it once, at that commit, without a review (an AI-attributed body or failing CI still refuses).",
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

// What the orchestrator's agent sees of its tools: names, descriptions,
// arguments and permissions. A worker after a deploy tells the agent its
// tools changed only when this did.
export function orchestratorToolsDigest(
  permissions: object = ORCHESTRATOR_PERMISSIONS
): string {
  return toolsDigest(DESCRIPTIONS, TOOL_SHAPES, permissions);
}

export function toolsDigest(
  descriptions: Record<string, string>,
  shapes: Record<string, z.ZodRawShape>,
  permissions: object
): string {
  const tools = Object.keys(shapes).map((name) => [
    name,
    descriptions[name],
    z.toJSONSchema(z.object(shapes[name])),
  ]);
  return createHash("sha256")
    .update(JSON.stringify([tools, permissions]))
    .digest("hex")
    .slice(0, 16);
}
