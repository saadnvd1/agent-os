import type { ChatAccess, DriverEvent, FileDiff } from "../events";
import { unifiedToDiff } from "../diff";
import { toolTitle } from "../tools";
import { PendingApprovals } from "./pending-approvals";

type P = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

// What an "edits" access lets through without asking: reading, searching
// and changing files, never a command or a fetch.
const EDITS_KINDS = new Set(["read", "search", "edit", "delete", "move"]);

const WANT = {
  allow: "allow_once",
  always: "allow_always",
  deny: "reject_once",
} as const;

interface Option {
  optionId: string;
  kind: string;
}

// The kind of tool Copilot asks about, as the chat's tool names.
export function permissionTool(kind: string): string {
  switch (kind) {
    case "execute":
      return "Bash";
    case "edit":
    case "delete":
    case "move":
      return "Edit";
    case "fetch":
      return "WebFetch";
    case "read":
      return "Read";
    default:
      return "Permissions";
  }
}

export function permissionDiff(input: P): FileDiff | undefined {
  const diff = str(input.diff);
  const file = str(input.fileName);
  if (!diff || !file) return undefined;
  return unifiedToDiff(file, diff, /^create file mode/m.test(diff));
}

// Copilot's permission prompts as approval cards, and the cards' answers as
// the option it offered for each.
export class CopilotApprovals {
  readonly pending: PendingApprovals;

  constructor(
    emit: (e: DriverEvent) => void,
    public access: ChatAccess
  ) {
    this.pending = new PendingApprovals(emit);
  }

  // The reply to one session/request_permission.
  async handle(p: P): Promise<unknown> {
    const options = (p.options as Option[]) ?? [];
    const call = (p.toolCall ?? {}) as P;
    const kind = str(call.kind);
    const pick = (want: string) =>
      options.find((o) => o.kind === want)?.optionId;
    const selected = (id: string | undefined) =>
      id
        ? { outcome: { outcome: "selected", optionId: id } }
        : { outcome: { outcome: "cancelled" } };

    if (
      this.access === "full" ||
      (this.access === "edits" && EDITS_KINDS.has(kind))
    )
      return selected(pick("allow_once"));

    const input = (call.rawInput ?? {}) as P;
    const name = permissionTool(kind);
    const command = str(input.command);
    const file = str(input.fileName) || str((call.locations as P[])?.[0]?.path);
    const o = await this.pending.ask({
      id: `approval-${str(call.toolCallId)}`,
      toolName: name,
      title:
        toolTitle(name, { command, file_path: file, url: input.url }) ||
        str(call.title) ||
        "Allow this",
      input: command ? { command } : { file, title: str(call.title) },
      diff: permissionDiff(input),
      canAlways: !!pick("allow_always"),
    });
    if (o.decision === "allow" || o.decision === "always")
      return selected(pick(WANT[o.decision]) ?? pick("allow_once"));
    if (o.decision === "deny") return selected(pick("reject_once"));
    return selected(undefined);
  }
}
