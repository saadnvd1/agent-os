"use client";

import { useState } from "react";
import { MessageCircleQuestion, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApprovalDecision, ChatItem } from "@/lib/chat/events";
import { cn } from "@/lib/utils";
import { ToolPreview } from "./Tools";

type ApprovalItem = Extract<ChatItem, { kind: "approval" }>;
type Respond = (id: string, answer: ApprovalDecision) => void;

// The agent wants to use a tool it isn't allowed to on its own.
function AccessCard({
  item,
  respond,
}: {
  item: ApprovalItem;
  respond: Respond;
}) {
  return (
    <div className="bg-primary/[0.06] space-y-3 rounded-xl p-3">
      <div className="flex items-start gap-2 text-sm">
        <ShieldQuestion className="text-primary mt-0.5 h-4 w-4 shrink-0" />
        <span className="min-w-0 break-words">{item.title}</span>
      </div>
      <ToolPreview name={item.toolName} input={item.input} diff={item.diff} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="ghost"
          className="h-11 md:h-9"
          onClick={() => respond(item.id, { decision: "deny" })}
        >
          Deny
        </Button>
        {item.canAlways && (
          <Button
            variant="secondary"
            className="h-11 md:h-9"
            onClick={() => respond(item.id, { decision: "always" })}
          >
            Always allow
          </Button>
        )}
        <Button
          className="h-11 md:h-9"
          onClick={() => respond(item.id, { decision: "allow" })}
        >
          Allow
        </Button>
      </div>
    </div>
  );
}

// The agent asks the reader to choose; "Other" takes free text.
function QuestionCard({
  item,
  respond,
}: {
  item: ApprovalItem;
  respond: Respond;
}) {
  const questions = item.questions ?? [];
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const answerOf = (q: string) =>
    [...(picked[q] ?? []), other[q]?.trim()].filter(Boolean).join(", ");
  const complete = questions.every((q) => answerOf(q.question));

  const toggle = (q: string, label: string, multi: boolean) =>
    setPicked((prev) => {
      const now = prev[q] ?? [];
      if (!multi) return { ...prev, [q]: [label] };
      return {
        ...prev,
        [q]: now.includes(label)
          ? now.filter((l) => l !== label)
          : [...now, label],
      };
    });

  return (
    <div className="bg-primary/[0.06] space-y-4 rounded-xl p-3">
      {questions.map((q) => (
        <div key={q.question} className="space-y-2">
          <div className="flex items-start gap-2 text-sm">
            <MessageCircleQuestion className="text-primary mt-0.5 h-4 w-4 shrink-0" />
            <span>{q.question}</span>
          </div>
          <div className="space-y-1.5 pl-6">
            {q.options.map((o) => {
              const on = picked[q.question]?.includes(o.label);
              return (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => toggle(q.question, o.label, q.multiSelect)}
                  className={cn(
                    "bg-background/60 hover:bg-background flex min-h-11 w-full flex-col rounded-lg px-3 py-2 text-left text-sm shadow-sm",
                    on && "ring-primary ring-2"
                  )}
                >
                  <span>{o.label}</span>
                  {o.description && (
                    <span className="text-muted-foreground text-xs">
                      {o.description}
                    </span>
                  )}
                </button>
              );
            })}
            <input
              value={other[q.question] ?? ""}
              onChange={(e) =>
                setOther({ ...other, [q.question]: e.target.value })
              }
              placeholder="Other…"
              className="bg-background/60 placeholder:text-muted-foreground h-11 w-full rounded-lg px-3 text-base shadow-sm outline-none md:h-9 md:text-sm"
            />
          </div>
        </div>
      ))}
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          className="h-11 md:h-9"
          onClick={() => respond(item.id, { decision: "deny" })}
        >
          Skip
        </Button>
        <Button
          className="h-11 md:h-9"
          disabled={!complete}
          onClick={() =>
            respond(item.id, {
              decision: "answer",
              answers: Object.fromEntries(
                questions.map((q) => [q.question, answerOf(q.question)])
              ),
            })
          }
        >
          Answer
        </Button>
      </div>
    </div>
  );
}

// What was asked and answered, once it's done.
function AnsweredQuestions({ item }: { item: ApprovalItem }) {
  const answers = (item.input as { answers?: Record<string, string> }).answers;
  return (
    <div className="text-muted-foreground space-y-1 text-xs">
      {(item.questions ?? []).map((q) => (
        <p key={q.question}>
          {q.question}{" "}
          <span className="text-foreground">
            {answers?.[q.question] ?? "answered"}
          </span>
        </p>
      ))}
    </div>
  );
}

export function Approval({
  item,
  respond,
}: {
  item: ApprovalItem;
  respond: Respond;
}) {
  if (item.status === "answered") return <AnsweredQuestions item={item} />;
  if (item.status !== "pending") return null;
  return item.questions ? (
    <QuestionCard item={item} respond={respond} />
  ) : (
    <AccessCard item={item} respond={respond} />
  );
}
