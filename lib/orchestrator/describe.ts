import type { TaskPR } from "../tasks/state";
import type { SessionFacts } from "./facts";

const STATUS_WORD: Record<SessionFacts["status"], string> = {
  running: "working",
  waiting: "needs input",
  idle: "idle",
  dead: "stopped",
};

export function ciWord(pr: TaskPR): string {
  if (pr.state !== "OPEN") return pr.state.toLowerCase();
  if (pr.checks === "pass") return "CI green";
  if (pr.checks === "fail")
    return pr.failing ? `CI failed: ${pr.failing}` : "CI failed";
  if (pr.checks === "pending") return "CI pending";
  return "no CI";
}

export const shortId = (id: string) => id.slice(0, 8);

function sessionLine(f: SessionFacts): string {
  const head = `- ${f.name} (${f.project ?? "no project"}, ${f.view}, id ${shortId(f.id)}): ${STATUS_WORD[f.status]}`;
  const parts = [f.activity ? `${head}, ${f.activity}` : head];
  if (f.task) {
    let task = `task ${f.task.state}`;
    if (f.task.pr) task += `, PR #${f.task.pr.number} ${ciWord(f.task.pr)}`;
    else task += ", no PR";
    if (f.task.blocked !== null) task += `, BLOCKED: ${f.task.blocked}`;
    parts.push(task);
  }
  if (f.stack) {
    const card = f.stack.ticket ? ` ${f.stack.ticket}` : "";
    parts.push(
      `stack "${f.stack.name}" ${f.stack.position}/${f.stack.of}${card} ${f.stack.status}`
    );
  }
  return parts.join(" | ");
}

// The sessions tool's answer: one line per session, busiest news first.
export function describeSessions(
  workspace: string,
  facts: SessionFacts[]
): string {
  if (!facts.length) return `No sessions are running in ${workspace}.`;
  const rank = { waiting: 0, running: 1, idle: 2, dead: 3 };
  const sorted = [...facts].sort((a, b) => rank[a.status] - rank[b.status]);
  const counts = (["running", "waiting"] as const)
    .map((s) => {
      const n = facts.filter((f) => f.status === s).length;
      return n ? `${n} ${STATUS_WORD[s]}` : null;
    })
    .filter(Boolean);
  const summary = counts.length ? ` (${counts.join(", ")})` : "";
  const noun = facts.length === 1 ? "session" : "sessions";
  return [
    `${facts.length} ${noun} in ${workspace}${summary}:`,
    ...sorted.map(sessionLine),
  ].join("\n");
}
