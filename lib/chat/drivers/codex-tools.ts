import type { FileDiff } from "../events";
import { toolTitle } from "../tools";
import { unifiedToDiff } from "../diff";
import type { ToolStart } from "./turn-items";

type P = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

export interface CodexChange {
  path: string;
  kind?: { type?: string };
  diff?: string;
}

// The command a shell was asked to run, without the shell around it.
export function shellCommand(command: unknown): string {
  const inner = str(command).replace(/^\/bin\/\w+ -l?c /, "");
  const quoted = inner.match(/^(["'])([\s\S]*)\1$/);
  if (!quoted) return inner;
  return quoted[1] === '"'
    ? quoted[2].replace(/\\(["\\$`])/g, "$1")
    : quoted[2];
}

export function changeDiff(changes: CodexChange[]): FileDiff | undefined {
  const c = changes[0];
  if (!c?.path) return undefined;
  return unifiedToDiff(c.path, c.diff ?? "", c.kind?.type === "add");
}

export function toolStart(item: P): ToolStart | null {
  switch (item.type) {
    case "commandExecution": {
      const command = shellCommand(item.command);
      return {
        name: "Bash",
        title: toolTitle("Bash", { command }),
        input: { command, cwd: item.cwd },
      };
    }
    case "fileChange": {
      const changes = (item.changes as CodexChange[]) ?? [];
      const name = changes[0]?.kind?.type === "add" ? "Write" : "Edit";
      const more = changes.length > 1 ? ` (+${changes.length - 1} more)` : "";
      return {
        name,
        title: `${toolTitle(name, { file_path: changes[0]?.path })}${more}`,
        input: { changes: changes.map((c) => c.path) },
        diff: changeDiff(changes),
      };
    }
    case "mcpToolCall": {
      const name = `mcp__${str(item.server)}__${str(item.tool)}`;
      return { name, title: toolTitle(name, {}), input: item.arguments };
    }
    case "dynamicToolCall":
      return {
        name: str(item.tool),
        title: str(item.tool),
        input: item.arguments,
      };
    case "webSearch": {
      const query = str(item.query) || str((item.action as P)?.query);
      return {
        name: "WebSearch",
        title: query ? toolTitle("WebSearch", { query }) : "Search the web",
        input: { query },
      };
    }
    default:
      return null;
  }
}

export function toolOutput(item: P): string | undefined {
  if (item.type === "commandExecution") return str(item.aggregatedOutput);
  if (item.type === "mcpToolCall") {
    const error = (item.error as P | null)?.message;
    if (error) return str(error);
    const content = ((item.result as P | null)?.content ?? []) as P[];
    return content.map((c) => str(c.text)).join("\n");
  }
  return undefined;
}
