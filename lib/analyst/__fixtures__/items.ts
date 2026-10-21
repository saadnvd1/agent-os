import type { ChatItem } from "../../chat/events";

let n = 0;
const id = (p: string) => `${p}-${++n}`;
const at = () => 1_000 + n;

export const user = (text: string, extra: Partial<ChatItem> = {}): ChatItem =>
  ({
    id: id("user"),
    createdAt: at(),
    kind: "user",
    text,
    ...extra,
  }) as ChatItem;

export const said = (text: string): ChatItem => ({
  id: id("assistant"),
  createdAt: at(),
  kind: "assistant",
  text,
});

export function tool(
  name: string,
  input: Record<string, unknown>,
  extra: Partial<Extract<ChatItem, { kind: "tool" }>> = {}
): ChatItem {
  return {
    id: id("tool"),
    createdAt: at(),
    kind: "tool",
    name,
    title: name,
    input,
    status: "done",
    ...extra,
  };
}

export const bash = (
  command: string,
  extra: Partial<Extract<ChatItem, { kind: "tool" }>> = {}
) => tool("Bash", { command }, extra);

export const edit = (path: string, before: string, after: string) =>
  tool("Edit", { file_path: path }, { diff: { path, before, after } });

export const end = (
  extra: Partial<Extract<ChatItem, { kind: "turn_end" }>> = {}
): ChatItem => ({
  id: id("end"),
  createdAt: at(),
  kind: "turn_end",
  durationMs: 1_000,
  costUsd: 0.1,
  ...extra,
});
