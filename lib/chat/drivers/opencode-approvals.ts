import type { ChatQuestion, DriverEvent } from "../events";
import { permissionCard } from "./opencode-rules";
import type { OpenCodeServer } from "./opencode-server";
import { answersInOrder, PendingApprovals } from "./pending-approvals";

type P = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

export const REPLY = {
  allow: "once",
  always: "always",
  deny: "reject",
} as const;

// OpenCode's permission and question requests as approval cards, answered
// through its reply endpoints. One answered from another client closes.
export class OpenCodeApprovals {
  readonly pending: PendingApprovals;

  constructor(
    emit: (e: DriverEvent) => void,
    private server: Pick<OpenCodeServer, "call">,
    private fail: (error: Error) => void
  ) {
    this.pending = new PendingApprovals(emit);
  }

  // Handles a request event for this conversation; false for any other.
  handle(type: unknown, p: P): boolean {
    if (type === "permission.asked") void this.permission(p);
    else if (type === "question.asked") void this.question(p);
    else if (type === "permission.replied" || type === "question.replied") {
      const id = `approval-${str(p.requestID)}`;
      if (this.pending.has(id))
        this.pending.respond(id, { decision: "expired" });
    } else return false;
    return true;
  }

  async permission(p: P): Promise<void> {
    const o = await this.pending.ask({
      id: `approval-${str(p.id)}`,
      ...permissionCard(p),
      canAlways: ((p.always as unknown[]) ?? []).length > 0,
    });
    if (o.decision === "expired" || o.decision === "answer") return;
    await this.server
      .call("POST", `/permission/${str(p.id)}/reply`, {
        reply: REPLY[o.decision],
      })
      .catch(this.fail);
  }

  async question(p: P): Promise<void> {
    const questions: ChatQuestion[] = ((p.questions as P[]) ?? []).map((q) => ({
      question: str(q.question),
      header: str(q.header),
      multiSelect: !!q.multiple,
      options: ((q.options as P[]) ?? []).map((o) => ({
        label: str(o.label),
        description: str(o.description),
      })),
    }));
    const o = await this.pending.ask({
      id: `approval-${str(p.id)}`,
      toolName: "AskUserQuestion",
      title: "Questions",
      input: { questions },
      questions,
      canAlways: false,
    });
    if (o.decision === "expired") return;
    const path = `/question/${str(p.id)}`;
    await (
      o.decision === "answer"
        ? this.server.call("POST", `${path}/reply`, {
            answers: answersInOrder(questions, o.answers),
          })
        : this.server.call("POST", `${path}/reject`)
    ).catch(this.fail);
  }
}
