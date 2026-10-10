import { prFor } from "../tasks/session";
import { AskRefused, raiseAsk, workSubject, type AskKind } from "./asks";
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
): Promise<{ subject: string; sha: string; url: string }> {
  const t = await gateTarget(workspaceId, ref);
  const pr = t.kind === "external" ? t.pr.pr : await prFor(t.task, true);
  const name = t.kind === "external" ? t.pr.name : t.task.name;
  if (!pr || pr.state !== "OPEN" || !pr.head)
    throw new Error(`${name} has no open PR to ask about merging`);
  if (!pr.head.toLowerCase().startsWith(sha.toLowerCase()))
    throw new Error(
      `PR #${pr.number}'s head is ${pr.head.slice(0, 7)}, not ${sha.slice(0, 7)}: ask about the commit that would merge`
    );
  return {
    subject: workSubject(t.kind === "external" ? t.pr.id : t.task.id),
    sha: pr.head,
    url: pr.url,
  };
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
  let raised;
  try {
    raised = raiseAsk({
      workspaceId,
      subject: merge?.subject ?? titleSubject(a.title),
      kind: merge ? "gate" : a.kind,
      title: a.title,
      detail: a.detail,
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
