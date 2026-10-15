"use client";

import { memo, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  CornerDownLeft,
  GitMerge,
  Lightbulb,
  MessageCircleQuestion,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useApplyCard } from "@/data/learning-cards";
import { useDismissNeedsYou } from "@/data/orchestrators";
import { LearningCardsHost } from "@/components/LearningCards/LearningCard";
import { useNeedsYou } from "@/hooks/useNeedsYou";
import type { NeedsYouItem } from "@/lib/orchestrator/needs-you-items";
import { cn } from "@/lib/utils";

const ICON = {
  ask: AlertCircle,
  question: MessageCircleQuestion,
  chat: MessageCircleQuestion,
  task: UserRound,
  card: Lightbulb,
} as const;

const STORE = "agentos:needs-you-open";

export interface NeedsYouActions {
  // Show the item where it is: the ask's card, the message, the session.
  onGo: (item: NeedsYouItem) => void;
  // Answer a question in the composer.
  onReply: (item: Extract<NeedsYouItem, { kind: "question" }>) => void;
}

// Pinned above the composer: everything waiting on Saad, one line each, until
// it is resolved. Dismissing an item only hides it; an ask stays open.
export const NeedsYouStrip = memo(function NeedsYouStrip({
  workspaceId,
  chatWaiting,
  onGo,
  onReply,
}: NeedsYouActions & { workspaceId: string; chatWaiting: boolean }) {
  const items = useNeedsYou(workspaceId, chatWaiting);
  const dismiss = useDismissNeedsYou(workspaceId);
  const cards = useApplyCard();
  // The learning card opened in place.
  const [openCard, setOpenCard] = useState<number | null>(null);
  // Open on a wide screen, closed on a phone, then as he left it. It renders
  // nothing until the orchestrator's data has loaded, so never on the server.
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    const saved = localStorage.getItem(STORE);
    return saved ? saved === "1" : window.innerWidth >= 768;
  });
  if (!items.length) return null;
  const toggle = () => {
    localStorage.setItem(STORE, open ? "0" : "1");
    setOpen(!open);
  };
  const hide = (item: NeedsYouItem) =>
    item.kind === "card"
      ? cards.dismiss(item.card.id)
      : dismiss.mutate(
          { key: item.key },
          {
            onSuccess: () =>
              toast("Hidden from Needs you", {
                action: {
                  label: "Undo",
                  onClick: () => dismiss.mutate({ key: item.key, undo: true }),
                },
              }),
            onError: (e) => toast.error(e.message),
          }
        );
  const newest = items[0];

  return (
    <section
      aria-label="Needs you"
      data-needs-you
      className="mb-2 overflow-hidden rounded-xl border border-amber-500/30 bg-amber-500/[0.06]"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-xs"
      >
        <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber-700 dark:text-amber-300">
          {items.length}
        </span>
        <span className="font-medium text-amber-700 dark:text-amber-300">
          Needs you
        </span>
        {!open && (
          <span className="text-muted-foreground min-w-0 flex-1 truncate">
            {newest.title}
          </span>
        )}
        <ChevronDown
          className={cn(
            "text-muted-foreground ml-auto h-3.5 w-3.5 shrink-0 transition-transform",
            !open && "-rotate-90"
          )}
        />
      </button>
      {open && (
        <ul
          className={cn(
            "divide-y divide-amber-500/15 overflow-y-auto border-t border-amber-500/15",
            openCard === null ? "max-h-48" : "max-h-[60vh]"
          )}
        >
          {items.map((item) => {
            const Icon =
              item.kind === "ask" && item.ask.kind === "gate"
                ? GitMerge
                : ICON[item.kind];
            const card = item.kind === "card" ? item.card : null;
            const expanded = !!card && openCard === card.id;
            return (
              <li key={item.key}>
                <div className="flex items-center">
                  <button
                    type="button"
                    aria-expanded={card ? expanded : undefined}
                    onClick={() =>
                      card ? setOpenCard(expanded ? null : card.id) : onGo(item)
                    }
                    className="hover:bg-foreground/[0.04] flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 text-left text-xs"
                  >
                    <Icon className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      {item.title}
                    </span>
                    <span className="text-muted-foreground/70 hidden max-w-[30%] shrink-0 truncate sm:block">
                      {item.sub}
                    </span>
                  </button>
                  {item.kind === "question" && (
                    <button
                      type="button"
                      onClick={() => onReply(item)}
                      aria-label="Reply"
                      className="text-muted-foreground hover:text-foreground flex size-11 shrink-0 items-center justify-center"
                    >
                      <CornerDownLeft className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => hide(item)}
                    aria-label="Dismiss"
                    className="text-muted-foreground hover:text-foreground flex size-11 shrink-0 items-center justify-center"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {card && expanded && (
                  <>
                    <LearningCardsHost
                      sessionId={card.sessionId}
                      only={card.id}
                      embedded
                    />
                    <button
                      type="button"
                      onClick={() => onGo(item)}
                      className="text-muted-foreground hover:text-foreground min-h-11 px-3 text-left text-xs underline-offset-2 hover:underline"
                    >
                      Open {card.sessionName}
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
});
