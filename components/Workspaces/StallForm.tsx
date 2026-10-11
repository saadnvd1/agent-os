"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useStallQuery, useUpdateStall } from "@/data/stall";
import {
  DEFAULT_STALL_MINUTES,
  MAX_STALL_MINUTES,
  MIN_STALL_MINUTES,
} from "@/lib/chat/stall-limits";

// How long a turn may produce nothing before it's flagged stalled and the
// workspace's orchestrator is told: app-wide.
export function StallForm() {
  const { data, isPending, isError, error } = useStallQuery();
  if (isPending)
    return <div className="bg-muted/40 h-24 animate-pulse rounded-lg" />;
  if (isError)
    return <p className="text-destructive text-sm">{error.message}</p>;
  return <Form key={data.minutes} saved={data.minutes} />;
}

function Form({ saved }: { saved: number }) {
  const update = useUpdateStall();
  const [on, setOn] = useState(saved > 0);
  const [text, setText] = useState(
    String(saved > 0 ? saved : DEFAULT_STALL_MINUTES)
  );
  const n = Number(text);
  const valid =
    Number.isInteger(n) && n >= MIN_STALL_MINUTES && n <= MAX_STALL_MINUTES;
  const minutes = on ? n : 0;
  const error =
    on && !valid
      ? `Between ${MIN_STALL_MINUTES} and ${MAX_STALL_MINUTES} minutes`
      : null;
  const dirty = !error && minutes !== saved;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (error) return;
        update.mutate(minutes, {
          onSuccess: () => toast.success("Stall alert saved"),
          onError: (err) => toast.error(err.message),
        });
      }}
      className="bg-muted/40 space-y-3 rounded-lg px-3 py-3"
    >
      <h3 className="text-sm font-medium">Stalled turns</h3>
      <p className="text-muted-foreground text-sm">
        A turn that produces nothing for this long (no text, tool call or
        result) shows as stalled, and the workspace&apos;s orchestrator is told
        once. A long command that is still printing, or a background command the
        agent is waiting on, isn&apos;t a stall.
      </p>
      <label className="flex min-h-11 items-center justify-between gap-3 text-sm md:min-h-9">
        Flag stalled turns
        <Switch
          checked={on}
          onCheckedChange={setOn}
          aria-label="Flag stalled turns"
        />
      </label>
      {on && (
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">After</span>
          <span className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              min={MIN_STALL_MINUTES}
              max={MAX_STALL_MINUTES}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Stall threshold, minutes"
              aria-invalid={!!error}
              className="h-11 w-24 text-base sm:h-9 md:text-sm"
            />
            <span className="text-muted-foreground">minutes</span>
          </span>
        </label>
      )}
      {error && <p className="text-destructive text-xs">{error}</p>}
      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          className="h-11 sm:h-8"
          disabled={!!error || !dirty || update.isPending}
        >
          Save
        </Button>
      </div>
    </form>
  );
}
