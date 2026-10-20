import type { TaskPR } from "../tasks/state";
import type { SessionFacts } from "./facts";
import { untrusted } from "./untrusted";

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
    return pr.failing
      ? `CI failed: ${untrusted("CI", pr.failing)}`
      : "CI failed";
  if (pr.checks === "pending") return "CI pending";
  return pr.mergeable === "CONFLICTING"
    ? "conflicts with its base, no CI yet"
    : "no checks yet";
}

export const shortId = (id: string) => id.slice(0, 8);

function sessionLine(f: SessionFacts): string {
  const head = `- ${f.name} (${f.project ?? "no project"}, ${f.quick ? "your quick change" : f.view}, id ${shortId(f.id)}): ${f.compacting ? "compacting context" : STATUS_WORD[f.status]}`;
  const parts = [
    f.activity ? `${head}, ${untrusted(f.name, f.activity)}` : head,
  ];
  if (f.task) {
    let task = `task ${f.task.state}`;
    if (f.task.pr) task += `, PR #${f.task.pr.number} ${ciWord(f.task.pr)}`;
    else task += ", no PR";
    if (f.task.blocked !== null)
      task += `, BLOCKED: ${untrusted(f.name, f.task.blocked)}`;
    parts.push(task);
  }
  if (f.plan)
    parts.push(
      `${f.plan.awaiting ? "plan ready, awaiting your approve_plan" : f.plan.planned ? "planned" : "no plan"}${f.plan.reason ? `: ${untrusted(f.name, f.plan.reason)}` : ""}`
    );
  if (f.waits?.on.length)
    parts.push(
      `waiting on ${f.waits.on
        .map(
          (w) =>
            `${untrusted(f.name, w.name)} (${w.kind === "reply" ? "reply" : w.kind === "idle" ? "to go idle" : "to merge"}, ${Math.max(1, Math.round(w.leftMs / 60_000))}m left)`
        )
        .join(", ")}`
    );
  if (f.waits?.by.length)
    parts.push(
      `${f.waits.by.map((n) => untrusted(f.name, n)).join(", ")} waiting on it`
    );
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
