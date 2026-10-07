import fs from "fs";
import type {
  CanUseTool,
  HookCallback,
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

// Plan mode sits over the access setting, and leaving it goes back to that.
export const sdkMode = (access: ChatAccess, plan: boolean): PermissionMode =>
  plan ? "plan" : SDK_MODE[access];

// The plan as the call carries it, or else as the agent wrote it to its
// plan file.
export function proposedPlan(
  toolInput: unknown,
  planFile?: string
): string | null {
  const inline = (toolInput as { plan?: unknown } | undefined)?.plan;
  if (typeof inline === "string" && inline.trim()) return inline;
  const named = (toolInput as { planFilePath?: unknown } | undefined)
    ?.planFilePath;
  // Only ever a plan file: the call's path comes from the model.
  const file = isPlanFile(named) ? named : planFile;
  if (!isPlanFile(file)) return null;
  try {
    const text = fs.readFileSync(file, "utf8");
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

// Where the agent keeps its plan in plan mode: a markdown file in its own
// plans folder (~/.claude/plans, or a project's .claude/plans). Nothing else
// is ever read as a plan, whatever path a call names.
export const isPlanFile = (path: unknown): path is string =>
  typeof path === "string" &&
  /[\\/]\.claude[\\/]plans[\\/][^\\/]+\.md$/.test(path);

// Words the CLI itself uses for a refused tool, so the call reads as stopped.
const DENIED = "The user doesn't want to proceed with this tool use.";

const PLAN_SHOWN =
  "The plan is now shown to the user as a card they can carry out. Stop here without restating it, and wait for their reply.";

interface Pending {
  item: Approval;
  suggestions?: Parameters<CanUseTool>[2]["suggestions"];
  resolve: (r: PermissionResult) => void;
}

// Turns the SDK's permission prompts into approval cards, and the reader's
// answers back into permission results.
export class Approvals {
  private pending = new Map<string, Pending>();

  constructor(
    private emit: (e: DriverEvent) => void,
    // The plan file the agent last wrote, for a plan it proposes without
    // repeating it in the call.
    private planFile: () => string | undefined = () => undefined
  ) {}

  canUseTool: CanUseTool = (toolName, input, options) => {
    // Already answered on its card by the question hook.
    if (toolName === "AskUserQuestion" && "answers" in input)
      return Promise.resolve({ behavior: "allow", updatedInput: input });
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

  // Full access approves every tool before canUseTool is asked, questions
  // included, so the agent's questions come through this hook instead.
  askQuestions: HookCallback = async (input, toolUseID, { signal }) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const result = await this.canUseTool(
      input.tool_name,
      (input.tool_input ?? {}) as Record<string, unknown>,
      {
        signal,
        toolUseID: toolUseID ?? input.tool_use_id,
      } as Parameters<CanUseTool>[2]
    );
    if (result?.behavior !== "allow")
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: result?.message ?? DENIED,
        },
      };
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: result.updatedInput,
      },
    };
  };

  // The plan the agent proposes on leaving plan mode becomes a plan card.
  // The tool itself is refused, so the conversation stays in plan mode until
  // the reader carries it out or asks for changes.
  proposePlan: HookCallback = async (input, toolUseID) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const plan = proposedPlan(input.tool_input, this.planFile());
    if (!plan) return {};
    this.emit({
      type: "item",
      item: {
        id: `plan-${toolUseID ?? input.tool_use_id}`,
        kind: "plan",
        plan,
        createdAt: Date.now(),
      },
    });
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: PLAN_SHOWN,
      },
    };
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
