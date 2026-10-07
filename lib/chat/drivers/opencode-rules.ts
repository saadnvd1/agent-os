import type { ChatAccess } from "../events";
import { toolDiff, toolTitle } from "../tools";
import { unifiedToDiff } from "../diff";
import type { ToolStart } from "./turn-items";

type P = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

export interface OpenCodeRule {
  permission: string;
  pattern: string;
  action: "allow" | "ask" | "deny";
}

const rule = (
  permission: string,
  action: OpenCodeRule["action"],
  pattern = "*"
): OpenCodeRule => ({ permission, pattern, action });

const READS = [
  "read",
  "glob",
  "grep",
  "list",
  "lsp",
  "skill",
  "todowrite",
  "todoread",
  "task",
  "question",
];
const ASKS = [
  "bash",
  "edit",
  "webfetch",
  "websearch",
  "codesearch",
  "external_directory",
  "doom_loop",
];

// What OpenCode may do without asking, as its permission rules (the last
// matching rule wins). Reading .env files always asks.
export function openCodeRules(access: ChatAccess): OpenCodeRule[] {
  if (access === "full")
    return [rule("*", "allow"), rule("external_directory", "allow")];
  return [
    rule("*", "ask"),
    ...READS.map((p) => rule(p, "allow")),
    rule("read", "ask", "*.env"),
    rule("read", "ask", "*.env.*"),
    rule("read", "allow", "*.env.example"),
    ...ASKS.map((p) => rule(p, "ask")),
    ...(access === "edits" ? [rule("edit", "allow")] : []),
  ];
}

const NAMES: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Write",
  glob: "Glob",
  grep: "Grep",
  list: "LS",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  task: "Task",
};

// An OpenCode tool call in the shape the chat's tool cards know.
export function openCodeTool(tool: string, input: unknown): ToolStart {
  const i = (input ?? {}) as P;
  const name = NAMES[tool] ?? tool;
  const mapped: P = {
    ...i,
    file_path: i.filePath ?? i.path,
    old_string: i.oldString,
    new_string: i.newString,
  };
  const title =
    tool === "list" ? `List ${str(i.path) || "."}` : toolTitle(name, mapped);
  return { name, title: title || tool, input: i, diff: toolDiff(name, mapped) };
}

// A permission OpenCode asks for, as an approval card's contents.
export function permissionCard(p: P) {
  const meta = (p.metadata ?? {}) as P;
  const permission = str(p.permission);
  const patterns = (p.patterns as string[] | undefined) ?? [];
  const path = str(meta.filepath);
  if (permission === "edit")
    return {
      toolName: "Edit",
      title: toolTitle("Edit", { file_path: path }),
      input: { file_path: path },
      diff: meta.diff ? unifiedToDiff(path, str(meta.diff)) : undefined,
    };
  if (permission === "bash") {
    const command = str(meta.command) || patterns.join(" ");
    return {
      toolName: "Bash",
      title: toolTitle("Bash", { command }),
      input: { command },
    };
  }
  return {
    toolName: NAMES[permission] ?? permission,
    title: `${permission}: ${patterns.join(", ") || path || "allow?"}`,
    input: { patterns, ...meta },
  };
}
