import type { ToolItem } from "./group";

export const MAX_FILES = 3;
export const MAX_FAILED = 3;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const baseName = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

const editedPath = (t: ToolItem): string | undefined => {
  if (t.diff?.path) return t.diff.path;
  const i = (t.input ?? {}) as Record<string, unknown>;
  const p = i.file_path ?? i.notebook_path;
  return typeof p === "string" ? p : undefined;
};

// What a finished run of steps did, after its count: "5 steps · edited a.ts,
// lib/b.ts · ran 2 commands". Files edited more than once are named once.
export function stepSummary(tools: ToolItem[]): string {
  const parts = [plural(tools.length, "step")];
  const edited = tools.filter((t) => t.diff || t.hasDiff);
  if (edited.length > 0) {
    const files = [
      ...new Set(
        edited
          .map(editedPath)
          .filter((p): p is string => !!p)
          .map(baseName)
      ),
    ];
    if (files.length === 0) parts.push(plural(edited.length, "edit"));
    else {
      const more = files.length - MAX_FILES;
      parts.push(
        `edited ${files.slice(0, MAX_FILES).join(", ")}${more > 0 ? ` +${more}` : ""}`
      );
    }
  }
  const commands = tools.filter((t) => t.name === "Bash").length;
  if (commands > 0) parts.push(`ran ${plural(commands, "command")}`);
  return parts.join(" · ");
}

// The failed steps' names, for the line under a group that had failures.
export function failedSteps(tools: ToolItem[]): {
  names: string[];
  more: number;
} {
  const failed = tools.filter((t) => t.status === "error");
  return {
    names: failed.slice(0, MAX_FAILED).map((t) => t.title),
    more: Math.max(0, failed.length - MAX_FAILED),
  };
}
