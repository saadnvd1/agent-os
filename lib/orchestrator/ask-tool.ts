import type { Session } from "../db";
import { prFor } from "../tasks/session";
import {
  AskRefused,
  openBySubject,
  raiseAsk,
  workSubject,
  type AskKind,
} from "./asks";
import { getCheck } from "./checks";
import { changedFiles, sensitiveFiles } from "./diff";
import { fetchRefs, repoOf } from "./repo";
import { titleSubject } from "./ask-text";
import { gateTarget } from "./external-pr";
import { addNote } from "./notes";

// The PR an ask about merging is pinned to: its subject is the task (or the
// PR no task owns), and its commit the PR's head, which `sha` must name.
// Saad's approval then lets sign_off merge it once at that commit, as an
// approval of an escalated gate does.
async function mergeTarget(
  workspaceId: string,
  ref: string,
  sha: string
): Promise<{ subject: string; sha: string; url: string; facts: string }> {
  const t = await gateTarget(workspaceId, ref);
  const pr = t.kind === "external" ? t.pr.pr : await prFor(t.task, true);
  const name = t.kind === "external" ? t.pr.name : t.task.name;
  if (!pr || pr.state !== "OPEN" || !pr.head)
    throw new Error(`${name} has no open PR to ask about merging`);
  if (!pr.head.toLowerCase().startsWith(sha.toLowerCase()))
    throw new Error(
      `PR #${pr.number}'s head is ${pr.head.slice(0, 7)}, not ${sha.slice(0, 7)}: ask about the commit that would merge`
    );
  const id = t.kind === "external" ? t.pr.id : t.task.id;
  const repo = t.kind === "external" ? t.pr.repo : repoOf(t.task);
  const refs =
    t.kind === "external"
      ? { base_branch: t.pr.base, branch_name: t.pr.branch }
      : t.task;
  return {
    subject: workSubject(id),
    sha: pr.head,
    url: pr.url,
    facts: await mergeFacts(repo, refs, id, pr.number, pr.head),
  };
}

// What AgentOS itself knows about the commit, under the orchestrator's
// words, so Saad never approves a merge on its description alone.
async function mergeFacts(
  repo: string,
  refs: Pick<Session, "base_branch" | "branch_name">,
  id: string,
  number: number,
  sha: string
): Promise<string> {
  const files = await changedFiles(repo, await fetchRefs(repo, refs), sha);
  const sensitive = sensitiveFiles(files);
  const review = getCheck(id, sha, "review")?.status ?? "none yet";
  return [
    `AgentOS: PR #${number} at ${sha.slice(0, 7)} changes ${files.length} file${files.length === 1 ? "" : "s"}`,
    sensitive.length
      ? `touches ${sensitive.map((f) => `${f.path} (${f.why})`).join(", ")}`
      : "",
    `review: ${review}`,
  ]
    .filter(Boolean)
    .join("; ");
}

// `ask_saad`: parks the item and returns at once. The same title again,
// while it's open, refreshes that ask rather than adding a second. With a
// task and sha it's an ask to merge that PR at that commit.
export async function askSaad(
  workspaceId: string,
  a: {
    title: string;
    detail: string;
    link?: string;
    kind: AskKind;
    task?: string;
    sha?: string;
  }
): Promise<string> {
  if (!a.task !== !a.sha)
    throw new Error(
      "Give both task and sha to ask about merging a PR at a commit, or neither"
    );
  const merge =
    a.task && a.sha ? await mergeTarget(workspaceId, a.task, a.sha) : null;
  // An ask the gates raised keeps their reason: the orchestrator's words
  // never replace it.
  const open = merge && openBySubject(workspaceId, merge.subject);
  if (open)
    return `Already on Saad's list as ask ${open.id}; left as it is. Carry on with everything else.`;
  let raised;
  try {
    raised = raiseAsk({
      workspaceId,
      subject: merge?.subject ?? titleSubject(a.title),
      kind: merge ? "gate" : a.kind,
      title: a.title,
      detail: merge ? `${a.detail}\n\n${merge.facts}` : a.detail,
      link: a.link ?? merge?.url ?? null,
      sha: merge?.sha ?? null,
    });
  } catch (error) {
    if (error instanceof AskRefused) return `Not asked: ${error.message}.`;
    throw error;
  }
  const { ask, created } = raised;
  const once = merge
    ? ` If he approves, sign_off merges it once, at ${merge.sha.slice(0, 7)} only.`
    : "";
  if (!created)
    return `Already on Saad's list as ask ${ask.id}; updated it.${once} Carry on with everything else.`;
  addNote(workspaceId, `Asked Saad: ${ask.title}`, "ask");
  return `Asked Saad (ask ${ask.id}).${once} Carry on with everything else; his answer reaches you as an event.`;
}
