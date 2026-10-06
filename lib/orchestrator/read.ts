import type { Session } from "../db";
import type { ChatItem } from "../chat/events";
import { listItems } from "../chat/store";
import { statusDetector } from "../status-detector";
import { matchesRef } from "../bus/format";
import { hostExec } from "../hosts";
import { shellQuote } from "../hosts/ssh";
import { workspaceSessions } from "./facts";
import { untrusted } from "./untrusted";

// About 4k tokens: what one read may return.
export const READ_CHAR_CAP = 16000;
const DEFAULT_LINES = 60;

// A session of this workspace by name, project/name, id or id prefix.
export function findWorkspaceSession(
  workspaceId: string,
  ref: string
): Session & { project_name: string } {
  const r = ref.trim().toLowerCase();
  const all = workspaceSessions(workspaceId);
  const matches = all.filter(
    (s) =>
      matchesRef(r, {
        id: s.id,
        name: s.name,
        projectName: s.project_name,
        tmuxName: s.tmux_name,
      }) ||
      (r.length >= 6 && s.id.startsWith(r))
  );
  if (matches.length === 1) return matches[0];
  if (!matches.length)
    throw new Error(
      `No session "${ref}" in this workspace. Call sessions to see them.`
    );
  throw new Error(
    `"${ref}" matches ${matches.length} sessions; use project/name or the id`
  );
}

// The end of a text, keeping whole lines, within the cap.
export function tail(text: string, lines: number, cap = READ_CHAR_CAP): string {
  const kept = text.replace(/\s+$/, "").split("\n").slice(-lines);
  let out = kept.join("\n");
  if (out.length > cap) out = `…${out.slice(out.length - cap + 1)}`;
  return out;
}

function itemText(i: ChatItem): string | null {
  switch (i.kind) {
    case "user":
      return `${i.from ? `[${i.from}]` : "[user]"} ${i.text}`;
    case "assistant":
      return `[assistant] ${i.text}`;
    case "tool":
      return `[tool ${i.status}] ${i.title}`;
    case "approval":
      return `[waiting on approval: ${i.status}] ${i.title}`;
    case "error":
      return `[error] ${i.message}`;
    case "turn_end":
      return i.interrupted ? "[turn stopped]" : "[turn ended]";
    case "command_output":
      return i.text;
    default:
      return null;
  }
}

// A chat as plain text, oldest first.
export function chatText(items: ChatItem[]): string {
  return items
    .map(itemText)
    .filter((t): t is string => t !== null)
    .join("\n");
}

export async function readSession(
  workspaceId: string,
  ref: string,
  lines = DEFAULT_LINES
): Promise<string> {
  const s = findWorkspaceSession(workspaceId, ref);
  const n = Math.max(1, Math.min(Math.floor(lines) || DEFAULT_LINES, 400));
  if (s.view === "chat") {
    const text = chatText(listItems(s.id).slice(-n * 2));
    const body = text ? untrusted(s.name, tail(text, n)) : "(no messages yet)";
    return `${s.name} (chat), last ${n} lines:\n${body}`;
  }
  await statusDetector.refreshCache();
  if (!statusDetector.sessionExists(s.tmux_name))
    return `${s.name} (terminal): its terminal isn't running.`;
  const { stdout: pane } = await hostExec(
    statusDetector.hostFor(s.tmux_name),
    `tmux capture-pane -t ${shellQuote(`=${s.tmux_name}:`)} -p -J -S -${n}`
  );
  const body = tail(pane, n);
  return `${s.name} (terminal), last ${n} lines:\n${body ? untrusted(s.name, body) : "(empty)"}`;
}
