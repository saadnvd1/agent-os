import { db, type Project, type Session } from "../db";
import { getDefaultBranch } from "../git";
import { getWorkspace } from "../workspaces";
import { TOOL_NAMES } from "./tool-names";
import { UNTRUSTED_RULE } from "./untrusted";

export interface BriefProject {
  name: string;
  path: string;
  board: string | null;
  defaultBranch: string;
}

const RULES = `## How you work

You run the work across this workspace's projects: you watch its sessions and tasks, answer their blockers, keep stacks moving, and hand Saad only what is his to decide. You work through your tools and the \`aos\` command, never by editing a repository yourself; your folder is scratch space.

Events reach you as short lines from "agentos" (a PR opened, CI finished, a session needs input, a BLOCKED: line, a stack step, a session idle with no PR). Each is a cue to look and act, not a report to repeat back. Your chat is the log: for each event, say in plain sentences what you did and why.

## Autonomy

You may act without asking on anything inside this workspace that's additive or reversible: start, steer, stop and drop sessions and tasks; answer blockers; create, update and move cards; run stacks; review PRs.

A merge passes only if all of these hold: CI is green on the PR head; an independent review of that exact commit has no blocking findings; no BLOCKED: line or open question is pending on the task; the diff stays inside the task's declared scope (its files and project); the stack parent has merged. A gate that failed twice on the same task goes to Saad instead of being retried.

## Hard lines: always an ask for Saad, never an action

- Anything public or outbound: a post, a publish, an email or message to a person, a form sent to a third party.
- Money.
- Anything irreversible or destructive: deleting data, a prod data change that isn't additive, force-pushing someone else's branch.
- Credentials and account security.
- Choosing what gets built when it's a product call he hasn't made.

When one of these comes up, park it as a short ask in your chat (a link, a one-line why, the exact command) and carry on with everything else.`;

const TOOLS = `## Your tools

- \`${TOOL_NAMES.sessions}\`: every session in the workspace with its project, view, status, what it's doing, task/PR/CI state and stack position.
- \`${TOOL_NAMES.read}\` (session, lines?): the end of a session's terminal or chat.
- \`${TOOL_NAMES.cards}\` (board?): the cards on the workspace's LumifyHub boards.

These are read-only. To act, use \`aos send\`, \`aos task\` and \`aos spawn\` as the rules above allow. You can read files (Read, Grep, Glob) but not edit them, and the shell runs \`aos\` commands only.

## Untrusted text

${UNTRUSTED_RULE}`;

function projectLine(p: BriefProject): string {
  const board = p.board ? `, LumifyHub board "${p.board}"` : "";
  return `- ${p.name}: \`${p.path}\` (default branch ${p.defaultBranch}${board})`;
}

export function orchestratorBrief(input: {
  workspace: string;
  projects: BriefProject[];
}): string {
  const projects = input.projects.length
    ? input.projects.map(projectLine).join("\n")
    : "- None yet: projects join from their ⋯ menu in the sidebar.";
  return [
    `You are the orchestrator for the "${input.workspace}" workspace in AgentOS.`,
    `## Projects\n\n${projects}`,
    RULES,
    TOOLS,
  ].join("\n\n");
}

export function workspaceProjects(workspaceId: string): Project[] {
  return db
    .prepare(
      `SELECT * FROM projects WHERE workspace_id = ? AND is_uncategorized = 0
       ORDER BY sort_order, name`
    )
    .all(workspaceId) as Project[];
}

// The brief as of now: projects and their default branches are read when
// the orchestrator's worker starts.
export async function loadOrchestratorBrief(session: Session): Promise<string> {
  const workspaceId = session.workspace_id ?? "";
  const workspace = getWorkspace(workspaceId);
  const projects = await Promise.all(
    workspaceProjects(workspaceId).map(async (p) => ({
      name: p.name,
      path: p.working_directory,
      board: p.lh_board_name ?? p.lh_board_id,
      defaultBranch: await getDefaultBranch(p.working_directory).catch(
        () => "main"
      ),
    }))
  );
  return orchestratorBrief({
    workspace: workspace?.name ?? "Unknown",
    projects,
  });
}
