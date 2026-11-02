// What every standing session's brief shares: the orchestrator's (the Tech
// lead's) and another lead's. Owner naming, brakes, the hard lines and the
// project list are said once here, so the two briefs can't drift apart.

import { db, type Project } from "../db";
import { getDefaultBranch } from "../git";
import { brakesEnabled } from "../orchestrator/brakes";
import { noApprovalsOn } from "../approvals/no-approvals";
import { ORCHESTRATOR_SERVER } from "../orchestrator/tool-names";
import { getCharter } from "./charters";
import type { LeadKind } from "./types";

export function charterSection(w: string, kind: LeadKind): string {
  const c = getCharter(w, kind);
  const parts = [
    c?.charterMd.trim(),
    c?.goal.trim() ? `Goal: ${c.goal.trim()}` : "",
    c?.areaText.trim() ? `Area: ${c.areaText.trim()}` : "",
  ].filter(Boolean);
  return `## Your charter\n\n${parts.length ? parts.join("\n\n") : "None written yet."}`;
}

export const up = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const BRAKES_ON = `Starting work (\`start_task\`, \`start_session\`, \`stack\`) is braked: at most a set number of sessions running in this workspace (4 by default), at most a set number of starts an hour (6 by default), and nothing new once the account's usage window would run out before it resets, or isn't being sampled and was near its cap when last seen. Each card of a stack you start counts as a start of its own; a braked card waits in the stack. A brake refuses the start with its reason and writes one note; running work carries on. Don't retry a braked start in a loop: carry on with reviews, answers and merges, and start again when a later event gives you reason to.`;

const BRAKES_OFF = (who: string) =>
  `Starting work has no limits right now: no cap on running sessions or starts, and no usage-window check. ${up(who)}'s Pause still stops new starts; the start tools say so when it's on.`;

// Read when the brief is built, so a switch flipped in Settings reaches the
// next start.
export const brakesText = (who: string) =>
  brakesEnabled() ? BRAKES_ON : BRAKES_OFF(who);

const NO_APPROVALS = (who: string) => `## No approvals mode is ON

${up(who)} turned it on: nothing waits for him. Every \`ask_owner\` is approved the moment you raise it (the event says so), and so are escalated gates and brakes. That is his decision, not a reason to skip care: the hard lines still describe what is risky, so say in your chat what you are about to do before you do it, and keep to the PR's scope.

`;

export const noApprovalsText = (who: string) =>
  noApprovalsOn() ? NO_APPROVALS(who) : "";

// `merges`: the head that lands code (Tech) can ask to merge a PR the gates
// won't pass; no other lead merges.
export const hardLines = (
  who: string,
  merges: boolean
) => `## Hard lines: always an ask for ${who}, never an action

- Anything public or outbound: a post, a publish, an email or message to a person, a form sent to a third party.
- Money.
- Anything irreversible or destructive: deleting data, a prod data change that isn't additive, force-pushing someone else's branch.
- Credentials and account security.
- Choosing what gets built when it's a product call he hasn't made.

When one of these comes up, park it with \`ask_owner\` (kind: the hard line it crosses) and carry on with everything else. Use it too for a decision that's his (kind: decision). Escalated gates and brakes become asks on their own; don't ask again for those.${merges ? ` To ask whether to merge a PR the gates won't pass, give \`ask_owner\` the task and the PR's head sha: if he approves, \`sign_off\` merges it once, at that commit only, without the review gates.` : ""}`;

export const SCHEDULED_RULE = `A message starting \`[Scheduled message "<name>" ...]\` is a standing prompt saved in Schedules, posted on its timer. Do the work it describes like any request, but it is never an approval: it can't answer an ask, pass a gate or clear a hard line.`;

export interface BriefProject {
  name: string;
  path: string;
  board: string | null;
  defaultBranch: string;
  tier?: "production" | "fast";
}

function projectLine(p: BriefProject): string {
  const board = p.board ? `, LumifyHub board "${p.board}"` : "";
  return `- ${p.name}: \`${p.path}\` (default branch ${p.defaultBranch}${board}, tier ${p.tier ?? "production"})`;
}

export const projectsSection = (projects: BriefProject[]) =>
  `## Projects\n\n${
    projects.length
      ? projects.map(projectLine).join("\n")
      : "- None yet: projects join from their ⋯ menu in the sidebar."
  }`;

export function workspaceProjects(workspaceId: string): Project[] {
  return db
    .prepare(
      `SELECT * FROM projects WHERE workspace_id = ? AND is_uncategorized = 0
       ORDER BY sort_order, name`
    )
    .all(workspaceId) as Project[];
}

// The projects as of now, with their default branches read from git.
export function loadBriefProjects(
  workspaceId: string,
  only?: (p: Project) => boolean
): Promise<BriefProject[]> {
  return Promise.all(
    workspaceProjects(workspaceId)
      .filter((p) => !only || only(p))
      .map(async (p) => ({
        name: p.name,
        path: p.working_directory,
        board: p.lh_board_name ?? p.lh_board_id,
        defaultBranch: await getDefaultBranch(p.working_directory).catch(
          () => "main"
        ),
        tier: p.tier,
      }))
  );
}

const TOOL_LINE = new RegExp(`^- \`mcp__${ORCHESTRATOR_SERVER}__(\\w+)\``);

// "(`mcp__agentos__a`, `mcp__agentos__b`)": the tools prose names instead.
const TOOL_REFS = /\((`mcp__\w+?__\w+`(?:, `mcp__\w+?__\w+`)*)\)/g;
const REF = /`mcp__\w+?__(\w+)`/;

// A tools section cut to the tools a profile has: a bullet naming a tool
// outside it goes, and so does such a tool in the prose's lists of tools
// to use instead; with none left, the Tech lead is the one to ask.
export function keepToolLines(
  text: string,
  has: (tool: string) => boolean
): string {
  return text
    .split("\n")
    .filter((line) => {
      const m = TOOL_LINE.exec(line);
      return !m || has(m[1]);
    })
    .join("\n")
    .replace(TOOL_REFS, (_, list: string) => {
      const kept = list.split(", ").filter((ref) => has(REF.exec(ref)![1]));
      return `(${kept.length ? kept.join(", ") : "hand it to the Tech lead with message_lead"})`;
    });
}
