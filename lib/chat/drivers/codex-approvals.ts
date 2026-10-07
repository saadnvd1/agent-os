import type { ChatQuestion, DriverEvent } from "../events";
import { toolTitle } from "../tools";
import { changeDiff, shellCommand, type CodexChange } from "./codex-mapper";
import { answersInOrder, PendingApprovals } from "./pending-approvals";

type P = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

const DECISION = {
  allow: "accept",
  always: "acceptForSession",
  deny: "decline",
  answer: "accept",
  expired: "cancel",
} as const;

// The legacy (v1) approval requests' words for the same answers.
const LEGACY = {
  allow: "approved",
  always: "approved_for_session",
  deny: "denied",
  answer: "approved",
  expired: "abort",
} as const;

// Codex's requests to the reader (run this command, write this file, answer
// these questions) as approval cards, and the cards' answers as replies.
export class CodexApprovals {
  readonly pending: PendingApprovals;
  private changes = new Map<string, CodexChange[]>();

  constructor(emit: (e: DriverEvent) => void) {
    this.pending = new PendingApprovals(emit);
  }

  // A file change's diff arrives on its item, before Codex asks about it.
  sawItem(item: P): void {
    if (item.type === "fileChange")
      this.changes.set(str(item.id), (item.changes as CodexChange[]) ?? []);
  }

  // Answers one request; resolves with the reply to send back.
  async handle(method: string, p: P): Promise<unknown> {
    const itemId = str(p.itemId);
    switch (method) {
      case "item/commandExecution/requestApproval": {
        const command = shellCommand(p.command);
        const o = await this.pending.ask({
          id: `approval-${str(p.approvalId) || itemId}`,
          toolName: "Bash",
          title: toolTitle("Bash", { command }) || "Run a command",
          input: { command, cwd: p.cwd, reason: p.reason },
          canAlways: true,
        });
        return { decision: DECISION[o.decision] };
      }
      case "item/fileChange/requestApproval": {
        const changes = this.changes.get(itemId) ?? [];
        const o = await this.pending.ask({
          id: `approval-${itemId}`,
          toolName: "Edit",
          title: toolTitle("Edit", { file_path: changes[0]?.path }),
          input: { files: changes.map((c) => c.path), reason: p.reason },
          diff: changeDiff(changes),
          canAlways: true,
        });
        return { decision: DECISION[o.decision] };
      }
      case "item/permissions/requestApproval": {
        const o = await this.pending.ask({
          id: `approval-${itemId}`,
          toolName: "Permissions",
          title: str(p.reason) || "Allow more access",
          input: { permissions: p.permissions, reason: p.reason },
          canAlways: true,
        });
        const allowed = o.decision === "allow" || o.decision === "always";
        return {
          permissions: allowed ? p.permissions : {},
          scope: o.decision === "always" ? "session" : "turn",
        };
      }
      case "item/tool/requestUserInput":
        return this.questions(itemId, (p.questions as P[]) ?? []);
      case "applyPatchApproval":
      case "execCommandApproval": {
        const o = await this.pending.ask({
          id: `approval-${str(p.callId) || itemId}`,
          toolName: method === "applyPatchApproval" ? "Edit" : "Bash",
          title:
            method === "applyPatchApproval" ? "Change files" : "Run a command",
          input: p,
          canAlways: true,
        });
        return { decision: LEGACY[o.decision] };
      }
      case "mcpServer/elicitation/request":
        return { action: "decline", content: null, _meta: null };
      default:
        return undefined;
    }
  }

  private async questions(itemId: string, raw: P[]): Promise<unknown> {
    const questions: ChatQuestion[] = raw.map((q) => ({
      question: str(q.question),
      header: str(q.header),
      multiSelect: false,
      options: ((q.options as P[] | null) ?? []).map((o) => ({
        label: str(o.label),
        description: str(o.description),
      })),
    }));
    const o = await this.pending.ask({
      id: `approval-${itemId}`,
      toolName: "AskUserQuestion",
      title: "Questions",
      input: { questions },
      questions,
      canAlways: false,
    });
    if (o.decision !== "answer") return { answers: {} };
    const lists = answersInOrder(questions, o.answers);
    return {
      answers: Object.fromEntries(
        raw.map((q, i) => [str(q.id), { answers: lists[i] }])
      ),
    };
  }
}
