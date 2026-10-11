// An open merge ask follows its PR's head. A task that rebases or pushes
// while the ask waits would otherwise show Saad a commit that's already
// gone; the ask is moved to the head it would merge, with a line on whether
// the PR's patch changed. The approve button is bound to the commit shown,
// so an answer from a screen that predates the move is refused (asks.ts).

import { db, type Session } from "../db";
import { hostLink } from "../hosts/remote-api";
import { moveAskHead, openAsks, taskSubject } from "./asks";
import type { SessionFacts } from "./facts";
import { addNote } from "./notes";
import { comparePatches } from "./patch";
import { fetchRefs, repoOf } from "./repo";

const short = (sha: string) => sha.slice(0, 7);

// Tasks only: a PR no task owns has no facts here.
export async function followAskHeads(
  workspaceId: string,
  facts: SessionFacts[]
): Promise<void> {
  for (const ask of openAsks(workspaceId)) {
    const f = facts.find((x) => taskSubject(x.id) === ask.subject);
    const pr = f?.task?.pr;
    if (!ask.sha || pr?.state !== "OPEN" || !pr.head || pr.head === ask.sha)
      continue;
    const task = db
      .prepare(`SELECT * FROM sessions WHERE id = ?`)
      .get(f!.id) as Session | undefined;
    if (!task || hostLink(task.host_id)) continue;
    try {
      const repo = repoOf(task);
      const base = await fetchRefs(repo, task);
      const { same, note } = await comparePatches(repo, base, ask.sha, pr.head);
      const what = same ? `same patch (rebased onto ${base})` : note;
      const line = `Head moved from ${short(ask.sha)} to ${short(pr.head)}: ${what}. Approving merges ${short(pr.head)}.`;
      if (moveAskHead(ask.id, ask.sha, pr.head, line))
        addNote(
          workspaceId,
          `Saad's ask on ${task.name} now names ${short(pr.head)} (${same ? "same patch" : "patch changed"}).`,
          "ask"
        );
    } catch (error) {
      console.error(`Following ${task.name}'s head in its ask:`, error);
    }
  }
}
