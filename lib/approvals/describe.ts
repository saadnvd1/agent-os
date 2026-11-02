// What an auto-approval reads as to a person: a sentence, with the command
// or other raw text behind a "details" toggle. The audit table keeps the raw
// subject; this is only how it is shown.

import type { AuditRow } from "./no-approvals";

export interface ApprovalLine {
  id: number;
  at: string;
  // The source in words ("an ask", "a chat").
  where: string;
  summary: string;
  // Raw text (a shell command, a path) for the details toggle.
  details: string | null;
}

const WHERE: Record<AuditRow["source"], string> = {
  ask: "An ask",
  brake: "A brake",
  plan: "A plan",
  chat: "A chat",
  terminal: "A terminal",
  "merge-approval": "A merge",
  mode: "The mode",
};

const READ = new Set(["Read", "Glob", "Grep", "LS"]);
const CHANGE = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

const SHELL_START = /^(bash|run|shell|execute|command)\b[:\s]/i;
const SHELL_WORDS =
  /(^|\s)(cd|ssh|scp|git|npm|npx|pnpm|rm|curl|sudo|cat|ls|sed|grep|kill|tmux|docker|kubectl|python3?|node)\s/;
const SHELL_CHARS = /&&|\|\||[|;`]|\$\(|\s\/[\w.-]+\/|~\//;

export const looksLikeCommand = (text: string) =>
  SHELL_START.test(text) || SHELL_WORDS.test(text) || SHELL_CHARS.test(text);

export function describeApproval(row: AuditRow): ApprovalLine {
  const base = {
    id: row.id,
    at: row.at,
    where: WHERE[row.source] ?? row.source,
  };
  const subject = row.subject.trim();
  if (row.source === "terminal") {
    const tool = subject.replace(/ in a terminal session$/, "");
    const summary =
      tool === "Bash"
        ? "Ran a command"
        : CHANGE.has(tool)
          ? "Changed a file"
          : READ.has(tool)
            ? "Read files"
            : `Used ${tool}`;
    return { ...base, summary, details: null };
  }
  if (row.source === "chat" && looksLikeCommand(subject))
    return {
      ...base,
      summary: "Ran a command",
      details: subject.replace(SHELL_START, "").trim() || subject,
    };
  return { ...base, summary: subject, details: null };
}
