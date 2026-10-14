"use client";

import { CornerDownLeft, X } from "lucide-react";
import { toast } from "sonner";
import { useDismissNeedsYou } from "@/data/orchestrators";
import type { NeedsRow } from "@/lib/inbox/counts";
import { cn } from "@/lib/utils";
import { inboxUiActions } from "@/stores/inboxUi";
import { needsYouFocusActions } from "@/stores/needsYouFocus";
import { orchestratorOpenActions } from "@/stores/orchestratorOpen";
import { sessionOpenActions } from "@/stores/sessionOpen";

const PILL = {
  input: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  ask: "bg-primary/15 text-primary",
  question: "bg-foreground/10 text-foreground/80",
} as const;
const PILL_LABEL = {
  input: "Input",
  ask: "Ask",
  question: "Question",
} as const;

function go(row: NeedsRow) {
  inboxUiActions.setOpen(false);
  if (row.kind === "input" && row.sessionId)
    sessionOpenActions.request(row.sessionId);
  else if (row.workspaceId) {
    orchestratorOpenActions.request(row.workspaceId);
    if (row.ask) needsYouFocusActions.ask(row.ask.id);
  }
}

function Row({ row }: { row: NeedsRow }) {
  const dismiss = useDismissNeedsYou(row.workspaceId ?? "");
  const hide = () =>
    dismiss.mutate(
      { key: row.key },
      {
        onSuccess: () =>
          toast("Hidden from Needs you", {
            action: {
              label: "Undo",
              onClick: () => dismiss.mutate({ key: row.key, undo: true }),
            },
          }),
        onError: (e) => toast.error(e.message),
      }
    );
  return (
    <li className="border-foreground/[0.07] flex items-center border-b last:border-0">
      <button
        type="button"
        onClick={() => go(row)}
        className="hover:bg-foreground/[0.04] flex min-h-12 min-w-0 flex-1 items-center gap-3 px-4 py-2 text-left"
      >
        <span
          className={cn(
            "w-[4.25rem] shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-medium",
            PILL[row.kind]
          )}
        >
          {PILL_LABEL[row.kind]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{row.title}</span>
          <span className="text-muted-foreground block truncate text-xs">
            {row.sub}
          </span>
        </span>
      </button>
      {row.question && row.workspaceId && (
        <button
          type="button"
          aria-label="Reply"
          title="Reply"
          onClick={() => {
            inboxUiActions.setOpen(false);
            orchestratorOpenActions.request(row.workspaceId!);
            needsYouFocusActions.reply(
              row.workspaceId!,
              row.question!.id,
              row.question!.text
            );
          }}
          className="text-muted-foreground hover:text-foreground flex size-11 shrink-0 items-center justify-center"
        >
          <CornerDownLeft className="h-3.5 w-3.5" />
        </button>
      )}
      {row.kind !== "input" && (
        <button
          type="button"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={hide}
          className="text-muted-foreground hover:text-foreground flex size-11 shrink-0 items-center justify-center"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}

export function NeedsYouList({ rows }: { rows: NeedsRow[] }) {
  if (!rows.length)
    return (
      <p className="text-muted-foreground py-10 text-center text-sm">
        Nothing needs you.
      </p>
    );
  return (
    <ul>
      {rows.map((row) => (
        <Row key={row.key} row={row} />
      ))}
    </ul>
  );
}
