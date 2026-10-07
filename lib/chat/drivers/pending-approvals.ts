import type {
  ApprovalDecision,
  ChatItem,
  ChatQuestion,
  DriverEvent,
} from "../events";

type Approval = Extract<ChatItem, { kind: "approval" }>;

export type ApprovalCard = Omit<
  Approval,
  "kind" | "status" | "createdAt" | "id"
> & { id: string };

// What the reader decided; expired when the turn or conversation ended
// before they did.
export type ApprovalOutcome = ApprovalDecision | { decision: "expired" };

const STATUS: Record<ApprovalOutcome["decision"], Approval["status"]> = {
  allow: "allowed",
  always: "allowed",
  deny: "denied",
  answer: "answered",
  expired: "expired",
};

// Approval cards for agents that ask over their own protocol: each card
// waits for the reader's answer, and the turn shows as waiting meanwhile.
export class PendingApprovals {
  private pending = new Map<
    string,
    { item: Approval; resolve: (o: ApprovalOutcome) => void }
  >();

  constructor(private emit: (e: DriverEvent) => void) {}

  ask(card: ApprovalCard): Promise<ApprovalOutcome> {
    const item: Approval = {
      ...card,
      kind: "approval",
      status: "pending",
      createdAt: Date.now(),
    };
    return new Promise((resolve) => {
      this.pending.get(item.id)?.resolve({ decision: "expired" });
      this.pending.set(item.id, { item, resolve });
      this.emit({ type: "item", item });
      this.emit({ type: "state", state: "waiting" });
    });
  }

  has(id: string): boolean {
    return this.pending.has(id);
  }

  respond(id: string, answer: ApprovalOutcome): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    const item: Approval = { ...p.item, status: STATUS[answer.decision] };
    if (answer.decision === "answer")
      item.input = { ...(p.item.input as object), answers: answer.answers };
    this.emit({ type: "item", item });
    if (!this.pending.size) this.emit({ type: "state", state: "running" });
    p.resolve(answer);
  }

  expireAll(): void {
    for (const id of [...this.pending.keys()])
      this.respond(id, { decision: "expired" });
  }
}

// The reader's answers to a question card, keyed by each question's text,
// as one list per question in the order asked.
export function answersInOrder(
  questions: ChatQuestion[],
  answers: Record<string, string>
): string[][] {
  return questions.map((q) => {
    const a = answers[q.question] ?? "";
    return q.multiSelect
      ? a
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : a
        ? [a]
        : [];
  });
}
