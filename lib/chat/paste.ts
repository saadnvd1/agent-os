import { fenced } from "./markdown/fence";

// What a paste into the composer becomes. Measured in bytes, not characters:
// the agent's context pays for bytes.
export const LONG_PASTE_BYTES = 32 * 1024;

export type PasteKind = "attachment" | "code" | "markdown" | "inline";

export interface Paste {
  text: string;
  html?: string;
  // VS Code puts {"mode": "<language>"} on the clipboard.
  editorMode?: string;
}

export interface TextAttachment {
  name: string;
  text: string;
  language?: string;
}

export const byteLength = (text: string) =>
  new TextEncoder().encode(text).length;

const NOT_CODE_MODES = new Set(["plaintext", "markdown", "text", ""]);

// VS Code's language ids, as fence languages.
const MODE_ALIASES: Record<string, string> = {
  typescriptreact: "tsx",
  javascriptreact: "jsx",
  shellscript: "bash",
};

const CODE_LINE = [
  /[;{}[\](,]\s*$/,
  /^\s*[}\])]/,
  /^\s*(import|export|from|const|let|var|function|def|class|return|if|elif|else|for|while|fn|pub|func|package|use|using|public|private|protected|async|await|try|catch|except|struct|enum|interface|type)\b.*[^.!?]$/,
  /^\s*(#include|#!|\/\/|\/\*|\*\/|<\?php|@\w+)/,
  /=>|->|::|===|!==|&&|\|\||\w+\(.*\)\s*$/,
  /^\s*<\/?[a-zA-Z][\w-]*(\s[^>]*)?\/?>\s*$/,
  /^\s*\$ |^\s*(npm|npx|yarn|pnpm|git|cd|sudo|brew|pip|docker|curl|ls|mkdir|rm|cp|mv|export) /,
  /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|FROM|WHERE)\b/,
  /^\s*["']?[\w-]+["']?\s*:\s*\S.*,?$/,
];

const PROSE_LINE = /^[A-Z"'(].*\s.*\s.*[.!?:"')]$/;
const MARKDOWN = /^(\s*([-*+]|\d+\.)\s|#{1,6}\s|>\s|`{3,}|~{3,})/m;

export function looksLikeCode(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return false;
  const code = lines.filter((l) => CODE_LINE.some((re) => re.test(l))).length;
  const prose = lines.filter(
    (l) => PROSE_LINE.test(l.trim()) && !/[;{}]\s*$/.test(l)
  ).length;
  const indented = lines.filter((l) => /^(\t| {2,})\S/.test(l)).length;
  if (prose / lines.length > 0.5) return false;
  return (
    code / lines.length >= 0.5 ||
    (code / lines.length >= 0.25 && indented / lines.length >= 0.25)
  );
}

const fromCodeEditor = (html = "") =>
  /<pre[\s>]/i.test(html) ||
  /white-space:\s*pre[^;]*;[^"]*font-family:[^";]*(mono|menlo|consolas|courier|monaco)/i.test(
    html
  ) ||
  /font-family:[^";]*(mono|menlo|consolas|courier|monaco)[^"]*white-space:\s*pre/i.test(
    html
  );

export function classifyPaste(paste: Paste): {
  kind: PasteKind;
  language?: string;
} {
  const { text, editorMode } = paste;
  const language =
    editorMode && !NOT_CODE_MODES.has(editorMode)
      ? (MODE_ALIASES[editorMode] ?? editorMode)
      : undefined;
  if (byteLength(text) >= LONG_PASTE_BYTES)
    return { kind: "attachment", language };
  if (!text.replace(/\n+$/, "").includes("\n")) return { kind: "inline" };
  if (language) return { kind: "code", language };
  if (MARKDOWN.test(text) && !looksLikeCode(text)) return { kind: "markdown" };
  if (fromCodeEditor(paste.html) || looksLikeCode(text))
    return { kind: "code" };
  return { kind: "markdown" };
}

// t3code's naming: pasted-text.txt, pasted-text-2.txt, ...
const numberOf = (name: string) =>
  name === "pasted-text.txt"
    ? 1
    : Number(name.match(/^pasted-text-(\d+)\.txt$/)?.[1] ?? 0);

// The next name, numbered past every one handed out so far (`last`) and
// every one still attached, so removing one never frees its name.
export function nextAttachment(
  taken: TextAttachment[],
  last: number
): { name: string; number: number } {
  const n = Math.max(last, ...taken.map((a) => numberOf(a.name))) + 1;
  return {
    name: n === 1 ? "pasted-text.txt" : `pasted-text-${n}.txt`,
    number: n,
  };
}

// No file attachments yet: long pastes ride along as fenced blocks.
export function composeMessage(
  markdown: string,
  attachments: TextAttachment[]
): string {
  return [
    markdown.trimEnd(),
    ...attachments.map((a) => fenced(a.text.replace(/\n+$/, ""), a.language)),
  ]
    .filter(Boolean)
    .join("\n\n");
}
