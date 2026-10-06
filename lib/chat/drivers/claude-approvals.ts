import type {
  CanUseTool,
  PermissionMode,
  PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  ApprovalDecision,
  ChatAccess,
  ChatItem,
  ChatQuestion,
  DriverEvent,
} from "../events";
import { toolDiff, toolTitle } from "../tools";

type Approval = Extract<ChatItem, { kind: "approval" }>;

export const SDK_MODE: Record<ChatAccess, PermissionMode> = {
  ask: "default",
  edits: "acceptEdits",
  full: "bypassPermissions",
};

// Words the CLI itself uses for a refused tool, so the call reads as stopped.
const DENIED = "The user doesn't want to proceed with this tool use.";

interface Pending {
  item: Approval;
  suggestions?: Parameters<CanUseTool>[2]["suggestions"];
  resolve: (r: PermissionResult) => void;
}

// Turns the SDK's permission prompts into approval cards, and the reader's
// answers back into permission results.
export class Approvals {
  private pending = new Map<string, Pending>();

  constructor(private emit: (e: DriverEvent) => void) {}

  canUseTool: CanUseTool = (toolName, input, options) => {
    const questions =
      toolName === "AskUserQuestion"
        ? ((input as { questions?: ChatQuestion[] }).questions ?? [])
        : undefined;
    const item: Approval = {
      id: `approval-${options.toolUseID}`,
      kind: "approval",
      toolName,
      title: options.title ?? toolTitle(toolName, input),
      input,
      diff: toolDiff(toolName, input),
      questions,
      canAlways:
        !questions &&
        !!options.suggestions?.length &&
        !options.suppressAlwaysAllowRule,
      status: "pending",
      createdAt: Date.now(),
    };
    return new Promise<PermissionResult>((resolve) => {
      this.pending.set(item.id, {
        item,
        suggestions: options.suggestions,
        resolve,
      });
      options.signal.addEventListener("abort", () => {
        this.settle(item.id, "expired", {
          behavior: "deny",
          message: DENIED,
        });
      });
      this.emit({ type: "item", item });
      this.emit({ type: "state", state: "waiting" });
    });
  };

  respond(id: string, answer: ApprovalDecision): void {
    const p = this.pending.get(id);
    if (!p) return;
    const input = p.item.input as Record<string, unknown>;
    if (answer.decision === "answer") {
      const answered = { ...input, answers: answer.answers };
      p.item = { ...p.item, input: answered };
      this.settle(id, "answered", {
        behavior: "allow",
        updatedInput: answered,
      });
    } else if (answer.decision === "deny") {
      this.settle(id, "denied", { behavior: "deny", message: DENIED });
    } else {
      this.settle(id, "allowed", {
        behavior: "allow",
        updatedInput: input,
        updatedPermissions:
          answer.decision === "always" ? p.suggestions : undefined,
      });
    }
  }

  // Everything still waiting is moot once the conversation ends.
  expireAll(): void {
    for (const id of [...this.pending.keys()])
      this.settle(id, "expired", { behavior: "deny", message: DENIED });
  }

  private settle(
    id: string,
    status: Approval["status"],
    result: PermissionResult
  ): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    this.emit({ type: "item", item: { ...p.item, status } });
    if (!this.pending.size) this.emit({ type: "state", state: "running" });
    p.resolve(result);
  }
}
