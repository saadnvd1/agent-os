import type { LhRichText } from "./types";

type Node = Exclude<LhRichText, string | null>;

const BLOCKS = new Set([
  "paragraph",
  "heading",
  "listItem",
  "taskItem",
  "codeBlock",
  "blockquote",
]);

// A card description as plain text: enough for an agent's prompt.
export function richTextToPlain(value: LhRichText): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();

  const lines: string[] = [];
  let buf = "";
  let prefix = "";
  const flush = () => {
    if (buf.trim()) lines.push(buf);
    buf = "";
  };
  const visit = (node: Node | string) => {
    if (typeof node === "string") {
      buf += node;
      return;
    }
    if (node.type === "text" && node.text) {
      if (!buf) {
        buf = prefix;
        prefix = "";
      }
      buf += node.text;
      return;
    }
    if (node.type === "hardBreak") return flush();
    const block = !!node.type && BLOCKS.has(node.type);
    if (block) flush();
    if (node.type === "listItem" || node.type === "taskItem") prefix = "- ";
    for (const child of node.content ?? []) if (child) visit(child);
    if (block) flush();
  };
  visit(value);
  flush();
  return lines.join("\n").trim();
}
