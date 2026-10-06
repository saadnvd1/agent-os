import type { FileDiff } from "./events";

// Provider-neutral summaries of common coding-agent tools, so every driver
// labels a tool call the same way.

const short = (s: string, max = 90) => {
  const line = s.trim().split("\n")[0];
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

const base = (p: unknown) =>
  typeof p === "string" ? p.split("/").slice(-2).join("/") : "";

type Input = Record<string, unknown>;

export function toolTitle(name: string, input: unknown): string {
  const i = (input ?? {}) as Input;
  const str = (k: string) => (typeof i[k] === "string" ? (i[k] as string) : "");
  switch (name) {
    case "Bash":
      // The agent's own one-line description reads better than the command.
      return (
        short(str("description")) || short(str("command")) || "Run command"
      );
    case "Read":
    case "Edit":
    case "Write":
    case "MultiEdit":
    case "NotebookEdit":
      return `${name} ${base(i.file_path ?? i.notebook_path)}`.trim();
    case "Grep":
      return `Search "${short(str("pattern"), 60)}"`;
    case "Glob":
      return `Find ${short(str("pattern"), 60)}`;
    case "WebFetch":
      return `Fetch ${short(str("url"), 70)}`;
    case "WebSearch":
      return `Search the web: ${short(str("query"), 60)}`;
    case "Skill":
      return `Skill: ${str("skill") || "unknown"}`;
    case "Task":
    case "Agent":
      return short(str("description")) || "Run a subagent";
    default:
      return name;
  }
}

export function toolDiff(name: string, input: unknown): FileDiff | undefined {
  const i = (input ?? {}) as Input;
  const path = typeof i.file_path === "string" ? i.file_path : null;
  if (!path) return undefined;
  if (name === "Edit") {
    return {
      path,
      before: String(i.old_string ?? ""),
      after: String(i.new_string ?? ""),
    };
  }
  if (name === "Write") {
    return { path, before: "", after: String(i.content ?? "") };
  }
  if (name === "MultiEdit" && Array.isArray(i.edits)) {
    const edits = i.edits as { old_string?: string; new_string?: string }[];
    return {
      path,
      before: edits.map((e) => e.old_string ?? "").join("\n…\n"),
      after: edits.map((e) => e.new_string ?? "").join("\n…\n"),
    };
  }
  return undefined;
}

export const MAX_TOOL_OUTPUT = 8000;

export function clipOutput(text: string): string {
  return text.length > MAX_TOOL_OUTPUT
    ? `${text.slice(0, MAX_TOOL_OUTPUT)}\n… (${text.length - MAX_TOOL_OUTPUT} more characters)`
    : text;
}
