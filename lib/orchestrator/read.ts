import type { Session } from "../db";
import type { ChatItem } from "../chat/events";
import { lastItems } from "../chat/store";
import { statusDetector } from "../status-detector";
import { resolveRef } from "../bus/resolve";
import { previousNames } from "../session-names";
import { hostExec } from "../hosts";
import { shellQuote } from "../hosts/ssh";
import { hostLink } from "../hosts/remote-api";
import { peerPane } from "../hosts/peer-sessions";
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
  const all = workspaceSessions(workspaceId);
  const old = previousNames();
  const r = resolveRef(
    ref,
    all.map((s) => ({
      id: s.id,
      name: s.name,
      projectName: s.project_name,
      tmuxName: s.tmux_name,
      previousNames: old.get(s.id) ?? [],
    }))
  );
  if (!r.ok)
    throw new Error(
      r.reason === "none"
        ? `No session "${ref}" in this workspace. Call sessions to see them.`
        : r.error
    );
  return all.find((s) => s.id === r.id)!;
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
    case "note":
      return `[${i.tone}] ${i.text}`;
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
  const link = hostLink(s.host_id);
  if (s.view === "chat" && link)
    return `${s.name} (chat on ${link.hostName}): its messages are on that machine; open it to read them.`;
  if (s.view === "chat") {
    const text = chatText(lastItems(s.id, n * 2));
    const body = text ? untrusted(s.name, tail(text, n)) : "(no messages yet)";
    return `${s.name} (chat), last ${n} lines:\n${body}`;
  }
  if (link) {
    const lines = await peerPane(link, s.id);
    const body = lines ? tail(lines.join("\n"), n) : "";
    return `${s.name} (terminal on ${link.hostName}), last ${n} lines:\n${body ? untrusted(s.name, body) : "(couldn't be read)"}`;
  }
  await statusDetector.refreshCache();
  if (!statusDetector.sessionExists(s.tmux_name, s.host_id || "local"))
    return `${s.name} (terminal): its terminal isn't running.`;
  const { stdout: pane } = await hostExec(
    s.host_id || "local",
    `tmux capture-pane -t ${shellQuote(`=${s.tmux_name}:`)} -p -J -S -${n}`
  );
  const body = tail(pane, n);
  return `${s.name} (terminal), last ${n} lines:\n${body ? untrusted(s.name, body) : "(empty)"}`;
}
