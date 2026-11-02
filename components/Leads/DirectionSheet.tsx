"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  ASheet,
  ASheetContent,
  ASheetDescription,
  ASheetHeader,
  ASheetTitle,
} from "@/components/a/ASheet";
import { Button } from "@/components/ui/button";
import { useConfirmPins, useDirectionAction } from "@/data/leads";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import type { DirectionPin } from "@/lib/leads/types";
import { cn } from "@/lib/utils";
import { CharterSheet } from "./CharterSheet";
import { pinDate, type DirectionChat } from "./direction-context";

const Label = ({ children }: { children: React.ReactNode }) => (
  <h3 className="label-mono text-muted-foreground px-1">{children}</h3>
);

function pinState(p: DirectionPin): string {
  if (p.supersededBy) return `replaced by pin #${p.supersededBy}`;
  if (p.retiredAt) return `taken down ${pinDate(p.retiredAt)}`;
  return "in force";
}

// The lead's proposed pins, all kept unless unticked, confirmed in one tap.
// For an adopted lead that tap is also its switch to a fresh start, which
// waits for its memo.
function Proposals({
  chat,
  sessionId,
}: {
  chat: DirectionChat;
  sessionId: string;
}) {
  const { view } = chat;
  const [dropped, setDropped] = useState<Set<number>>(new Set());
  const confirm = useConfirmPins(sessionId);
  const keep = view.proposals.filter((p) => !dropped.has(p.id));
  const blocked = view.switchPending && !view.memo;
  const toggle = (id: number) =>
    setDropped((d) => {
      const next = new Set(d);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const n = keep.length;
  const label = view.switchPending
    ? n
      ? `Pin ${n} and switch over`
      : "Switch over"
    : n
      ? `Pin ${n}`
      : "Drop all";
  return (
    <section className="space-y-2">
      <Label>Proposed by the {view.title}</Label>
      {view.switchPending && (
        <p className="text-muted-foreground px-1 text-xs leading-relaxed">
          It keeps its old conversation until you confirm. Then it starts fresh
          on its memo and the pins you keep. Its chat stays here either way.
        </p>
      )}
      {view.proposals.map((p) => {
        const on = !dropped.has(p.id);
        return (
          <button
            key={p.id}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => toggle(p.id)}
            className={cn(
              "flex min-h-11 w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left text-sm",
              on ? "bg-foreground/[0.05]" : "text-muted-foreground"
            )}
          >
            <span
              className={cn(
                "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border",
                on && "border-primary bg-primary text-primary-foreground"
              )}
            >
              {on && <Check className="h-3 w-3" />}
            </span>
            <span className="min-w-0 flex-1 break-words">
              &ldquo;{p.quote}&rdquo;
            </span>
          </button>
        );
      })}
      <Button
        className="h-11 w-full md:h-9"
        disabled={blocked || confirm.isPending}
        onClick={() =>
          confirm.mutate(
            {
              workspaceId: view.workspaceId,
              kind: view.kind,
              confirm: keep.map((p) => p.id),
              switchOver: view.switchPending,
            },
            { onError: (e) => toast.error(e.message) }
          )
        }
      >
        {confirm.isPending && <Loader2 className="animate-spin" />}
        {blocked ? "Waiting for its memo" : label}
      </Button>
    </section>
  );
}

// Everything pinned for this lead, newest first, with its memo.
export function DirectionSheet({
  chat,
  sessionId,
  open,
  onOpenChange,
}: {
  chat: DirectionChat;
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const wide = useMediaQuery("(min-width: 768px)");
  const { view } = chat;
  const act = useDirectionAction(sessionId);
  const [memoOpen, setMemoOpen] = useState(false);
  const [charterOpen, setCharterOpen] = useState(false);
  const past = view.history.filter((p) => p.supersededBy || p.retiredAt);
  const review = view.proposals.length > 0 || view.switchPending;
  return (
    <ASheet
      open={open}
      onOpenChange={(o) => {
        if (!o) setMemoOpen(false);
        onOpenChange(o);
      }}
    >
      <ASheetContent
        side={wide ? "right" : "bottom"}
        className={wide ? "w-full max-w-md" : "max-h-[85dvh] rounded-t-2xl"}
      >
        <ASheetHeader className="pr-12">
          <ASheetTitle>Direction · {view.title}</ASheetTitle>
          <ASheetDescription>
            Your own words, copied from your messages here. The other leads and
            the chief read these, never this chat.
          </ASheetDescription>
        </ASheetHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-6">
          {review && <Proposals chat={chat} sessionId={sessionId} />}
          <section className="space-y-2">
            <Label>In force</Label>
            {view.pins.length === 0 && (
              <p className="text-muted-foreground px-1 text-sm">
                Nothing pinned. Use the pin on any of your messages in this
                chat.
              </p>
            )}
            {view.pins.map((p) => (
              <div
                key={p.id}
                className="bg-foreground/[0.04] flex items-start gap-2 rounded-lg py-2 pr-1 pl-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm break-words whitespace-pre-wrap">
                    &ldquo;{p.quote}&rdquo;
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    pin #{p.id} · you, {pinDate(p.setAt)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-11 shrink-0 md:h-8"
                  disabled={act.isPending}
                  onClick={() =>
                    act.mutate(
                      { action: "unpin", pinId: p.id },
                      { onError: (e) => toast.error(e.message) }
                    )
                  }
                >
                  Unpin
                </Button>
              </div>
            ))}
          </section>
          <section className="space-y-2">
            <Label>Charter</Label>
            <Button
              variant="secondary"
              className="h-11 w-full md:h-9"
              onClick={() => setCharterOpen(true)}
            >
              Edit charter
            </Button>
          </section>
          <section className="space-y-2">
            <Label>Memo</Label>
            {view.memo ? (
              <button
                type="button"
                onClick={() => setMemoOpen(!memoOpen)}
                className="bg-foreground/[0.04] block w-full rounded-lg px-3 py-2 text-left"
              >
                <p
                  className={cn(
                    "text-sm break-words whitespace-pre-wrap",
                    !memoOpen && "line-clamp-4"
                  )}
                >
                  {view.memo.text}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  Written by the lead · {pinDate(view.memo.createdAt)}
                  {!memoOpen && " · tap to read all"}
                </p>
              </button>
            ) : (
              <p className="text-muted-foreground px-1 text-sm">
                No memo yet. The lead writes one to carry across a fresh start.
              </p>
            )}
          </section>
          {past.length > 0 && (
            <section className="space-y-2">
              <Label>Earlier</Label>
              {past.map((p) => (
                <div key={p.id} className="px-1">
                  <p className="text-muted-foreground text-sm break-words">
                    &ldquo;{p.quote}&rdquo;
                  </p>
                  <p className="text-muted-foreground/80 text-xs">
                    pin #{p.id} · {pinDate(p.setAt)} · {pinState(p)}
                  </p>
                </div>
              ))}
            </section>
          )}
        </div>
        <CharterSheet
          workspaceId={view.workspaceId}
          kind={view.kind}
          name={view.title}
          open={charterOpen}
          onOpenChange={setCharterOpen}
        />
      </ASheetContent>
    </ASheet>
  );
}
