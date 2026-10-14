"use client";

import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { useSnapshot } from "valtio";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { TasksPanel } from "@/components/Tasks";
import { MessagesPanel } from "@/components/Bus";
import { useInbox } from "@/hooks/useInbox";
import { useBusMessages } from "@/data/bus";
import { pickTab, type InboxTab } from "@/lib/inbox/counts";
import { cn } from "@/lib/utils";
import { inboxUi, inboxUiActions, lastInboxTab } from "@/stores/inboxUi";
import { settingsUiActions } from "@/stores/settingsUi";
import { NeedsYouList } from "./NeedsYouList";

const TABS: { id: InboxTab; label: string }[] = [
  { id: "needs", label: "Needs you" },
  { id: "tasks", label: "Tasks" },
  { id: "messages", label: "Messages" },
];

// Everything waiting on you, in one panel: under the bar's Inbox button on a
// wide screen, centred on a phone.
export function InboxDialog() {
  const { open, request } = useSnapshot(inboxUi);
  const { rows, counts } = useInbox();
  const { data: messages } = useBusMessages();
  const [tab, setTab] = useState<InboxTab>("needs");
  // Chosen as the panel opens, not as its counts change under his hands.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open)
      setTab(
        pickTab({
          explicit: request ?? undefined,
          needs: counts.needs,
          last: lastInboxTab(),
        })
      );
  }

  const choose = (next: InboxTab) => {
    setTab(next);
    inboxUiActions.rememberTab(next);
  };

  // Looking at Messages reads them, including ones arriving meanwhile.
  useEffect(() => {
    if (!open || tab !== "messages" || !messages?.length) return;
    inboxUiActions.markSeen(messages.reduce((n, m) => Math.max(n, m.id), 0));
  }, [open, tab, messages]);

  const count = {
    needs: counts.needs,
    tasks: counts.tasks,
    messages: counts.messages,
  };

  return (
    <Dialog open={open} onOpenChange={inboxUiActions.setOpen}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={cn(
          "flex max-h-[min(85vh,40rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg",
          "md:top-12 md:right-3 md:left-auto md:max-w-md md:translate-x-0 md:translate-y-0"
        )}
      >
        <DialogTitle className="sr-only">Inbox</DialogTitle>
        <DialogDescription className="sr-only">
          Sessions, tasks and messages waiting on you.
        </DialogDescription>
        <div
          role="tablist"
          className="border-foreground/[0.07] flex shrink-0 items-center gap-1 border-b px-2"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => choose(t.id)}
              className={cn(
                "-mb-px flex min-h-11 items-center gap-1.5 border-b-2 px-2.5 text-sm transition-colors",
                tab === t.id
                  ? "border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground border-transparent"
              )}
            >
              {t.label}
              {count[t.id] > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 font-mono text-[10px] leading-4 tabular-nums",
                    t.id === "needs"
                      ? "bg-primary text-primary-foreground"
                      : "bg-foreground/10 text-foreground/80"
                  )}
                >
                  {count[t.id]}
                </span>
              )}
            </button>
          ))}
          <button
            type="button"
            aria-label="Notification settings"
            title="Notification settings"
            onClick={() => {
              inboxUiActions.setOpen(false);
              settingsUiActions.open("notifications");
            }}
            className="text-muted-foreground hover:text-foreground ml-auto flex size-9 items-center justify-center rounded-md"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto",
            tab !== "needs" && "p-4"
          )}
        >
          {tab === "needs" && <NeedsYouList rows={rows} />}
          {tab === "tasks" && <TasksPanel />}
          {tab === "messages" && <MessagesPanel />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
