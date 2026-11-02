"use client";

import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useChiefView } from "@/data/leads";
import { LeadAvatar } from "@/components/SessionList/RowParts";
import { CHIEF, memberLetter } from "@/lib/leads/order";
import { CharterSheet } from "./CharterSheet";

// The row above a chief of staff's messages: whose chief it is, what it
// reads (the leads' records, never their chats), and when it acts. Null in
// any other chat.
export const ChiefStrip = memo(function ChiefStrip({
  sessionId,
  standing,
}: {
  sessionId: string;
  standing: boolean;
}) {
  const { data: chief } = useChiefView(sessionId, standing);
  const [editing, setEditing] = useState(false);
  if (!chief) return null;
  const acts =
    chief.autonomy === "acts"
      ? "Acts on its own in this workspace"
      : "Acts only when you ask";
  const when = chief.sweep?.when ?? "";
  const sweep = !chief.sweep
    ? null
    : chief.sweep.nextRunAt
      ? `Read-only sweep ${when.charAt(0).toLowerCase()}${when.slice(1)}`
      : "Its sweep is paused";
  return (
    <div className="mx-auto w-full max-w-3xl px-3 pt-3">
      <div className="bg-muted/40 flex min-h-11 items-center gap-2.5 rounded-xl border px-3 py-2">
        <LeadAvatar
          member={{
            kind: CHIEF,
            letter: memberLetter(CHIEF),
            title: "Chief of staff",
          }}
          size="md"
        />
        <div className="min-w-0 flex-1 text-sm leading-snug">
          <p className="truncate">
            <span className="font-medium">Chief of staff</span>
            <span className="text-muted-foreground">
              {" "}
              · {chief.workspace} workspace
            </span>
          </p>
          <p className="text-muted-foreground line-clamp-2 text-xs">
            Reads records, not chats. {acts}.{sweep && ` ${sweep}.`}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-11 shrink-0 md:h-8"
          onClick={() => setEditing(true)}
        >
          Charter
        </Button>
      </div>
      <CharterSheet
        workspaceId={chief.workspaceId}
        kind={CHIEF}
        name="Chief of staff"
        open={editing}
        onOpenChange={setEditing}
      />
    </div>
  );
});
