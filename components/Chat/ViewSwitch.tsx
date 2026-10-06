"use client";

import { MessageSquare, SquareTerminal } from "lucide-react";
import type { Session } from "@/lib/db";
import { supportsChat } from "@/lib/chat/capabilities";
import { viewSwitchActions } from "@/stores/viewSwitch";
import { cn } from "@/lib/utils";

// Chat or terminal for one session: the same conversation either way.
export function ViewSwitch({
  session,
}: {
  session: Session | null | undefined;
}) {
  if (!session || !supportsChat(session.agent_type)) return null;
  if (session.host_id && session.host_id !== "local") return null;
  // A task's agent runs in its terminal with its brief; chat would end it.
  if (session.task_prompt) return null;
  const options = [
    { view: "chat" as const, icon: MessageSquare, label: "Chat" },
    { view: "terminal" as const, icon: SquareTerminal, label: "Terminal" },
  ];
  return (
    <div className="bg-foreground/[0.05] flex shrink-0 items-center rounded-lg p-0.5">
      {options.map(({ view, icon: Icon, label }) => (
        <button
          key={view}
          type="button"
          aria-label={label}
          aria-pressed={session.view === view}
          title={label}
          onClick={(e) => {
            e.stopPropagation();
            if (session.view !== view)
              viewSwitchActions.request(session.id, view);
          }}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-md px-2 text-xs transition-colors md:h-6",
            session.view === view
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
