"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useReportDraft } from "@/data/reports";
import type { NextPromptDraft } from "@/lib/reports/types";

// The analyst's drafted next prompt, shown in full. Approve & send is the one
// click; nothing is sent without it.
export function DraftCard({
  sessionId,
  draft,
}: {
  sessionId: string;
  draft: NextPromptDraft;
}) {
  const act = useReportDraft(sessionId);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(draft.text);
  const ref = { source: draft.source, id: draft.id, linkId: draft.linkId };
  const decided = draft.status !== "pending";

  if (decided)
    return (
      <p className="text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 text-sm">
        {draft.status === "sent"
          ? "Sent to the coding agent."
          : draft.status === "dismissed"
            ? "Draft dismissed."
            : "A newer report replaced this draft."}
      </p>
    );

  return (
    <section
      aria-label="Drafted next prompt"
      className="bg-card space-y-3 rounded-xl p-4 shadow-sm"
    >
      <h3 className="text-sm font-semibold">Drafted next prompt</h3>
      {editing ? (
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          aria-label="Edit the prompt"
        />
      ) : (
        <p className="bg-muted/50 rounded-lg p-3 text-sm whitespace-pre-wrap">
          {draft.text}
        </p>
      )}
      {act.isError && (
        <p className="text-destructive text-sm">{act.error.message}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-11 flex-1"
          disabled={act.isPending || !text.trim()}
          onClick={() =>
            act.mutate({
              ...ref,
              action: "send",
              text: editing ? text : undefined,
            })
          }
        >
          Approve &amp; send
        </Button>
        <Button
          variant="secondary"
          className="min-h-11"
          disabled={act.isPending}
          onClick={() => setEditing((e) => !e)}
        >
          {editing ? "Cancel edit" : "Edit"}
        </Button>
        <Button
          variant="ghost"
          className="min-h-11"
          disabled={act.isPending}
          onClick={() => act.mutate({ ...ref, action: "dismiss" })}
        >
          Dismiss
        </Button>
      </div>
    </section>
  );
}
