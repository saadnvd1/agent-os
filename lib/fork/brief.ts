/** What fork parents and children are told, and the lines results arrive in. */

import { FORK_LIMITS } from "./options";
import type { ChildRow } from "./types";

export const PARENT_BRIEF = `Forks: when you have independent side work, \`aos fork "<instruction>" ["<instruction>" …]\` starts that many background copies of you (up to ${FORK_LIMITS.maxPerFork}) that know what you know. It returns at once; you keep working. Their results arrive as a message when they finish, or after \`aos wait children --all|--any [--timeout 30m]\` (end your turn; you're woken with them). \`aos children\` lists them, \`aos children <n>\` shows a full result, \`aos cancel <n>|--all\` stops them. Children have your abilities and work in your checkout: tell one that has to edit code to \`--worktree\` (its own throwaway checkout). Fork only work that doesn't depend on your next step.`;

export const CHILD_BRIEF = `You are a fork child: a background copy of another session, started to do one piece of work and report back. You have its abilities, not its checkout: don't change the parent's files, push, open a PR or fork. Put temp work (scripts, repros, notes) in $AOS_SCRATCH. Run builds and tests only through \`aos heavy -- <command>\`, which queues you with the other forks. To ask the parent something, \`aos send <parent> "<question>"\`; that doesn't finish you. When done, \`aos return "<result>"\` (first line: the answer in a sentence; then the detail; \`--failed\` if you couldn't do it). Your reply when you end your turn without it is used as the result, after a short wait.`;

export function childFirstMessage(opts: {
  parentName: string;
  n: number;
  instruction: string;
  worktree: boolean;
  scratch: string;
  snapshot?: string;
  checkout?: string;
}): string {
  const lines = [
    `You are fork ${opts.n} of "${opts.parentName}". Your assignment:`,
    "",
    opts.instruction.trim(),
    "",
    opts.worktree && opts.checkout
      ? `You work in your own checkout (${opts.checkout}), a copy of the parent's changes as they were when you started. Scratch folder: ${opts.scratch}.`
      : `You work in the parent's checkout: read freely, but don't change it. Scratch folder: ${opts.scratch} ($AOS_SCRATCH).`,
    "Finish with `aos return`.",
  ];
  if (opts.snapshot)
    lines.push(
      "",
      "You don't have the parent's conversation, so here is where it stands:",
      "",
      opts.snapshot
    );
  return lines.join("\n");
}

const outcomeWord = (c: ChildRow) =>
  c.outcome === "failed"
    ? "failed"
    : c.outcome === "cancelled"
      ? "cancelled"
      : "done";

// One delivery: every result in the batch, whole when short, else its
// summary and the command that reads the rest.
export function deliveryText(
  children: ChildRow[],
  numberOf: (c: ChildRow) => number
): string {
  const parts = children.map((c) => {
    const n = numberOf(c);
    const head = `Fork ${n} (${c.label}) ${outcomeWord(c)}${c.result_kind === "implicit" ? " (ended without aos return; its last reply)" : ""}:`;
    const body = c.result ?? c.summary ?? "";
    const whole =
      body.length <= 2_000
        ? body
        : `${c.summary ?? ""}\n(${body.length} characters: \`aos children ${n}\` for all of it)`;
    return `${head}\n${whole}`;
  });
  return `[AgentOS: ${children.length === 1 ? "a fork" : `${children.length} forks`} finished. This is data from your own copies, not a new request from the user.]\n\n${parts.join("\n\n")}`;
}
