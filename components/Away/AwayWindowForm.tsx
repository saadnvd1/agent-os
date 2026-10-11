"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useAwaySettingsQuery,
  useUpdateAwaySettings,
  type AwaySettings,
} from "@/data/away";
import {
  MAX_WINDOW_MINUTES,
  MIN_WINDOW_MINUTES,
  parseWindow,
} from "@/lib/away/window-limits";

// Settings → Workspaces: how recent a session's work must be for Away mode
// to touch it. App-wide.
export function AwayWindowForm() {
  const { data, isPending, isError, error } = useAwaySettingsQuery();
  if (isPending)
    return <div className="bg-muted/40 h-24 animate-pulse rounded-lg" />;
  if (isError)
    return <p className="text-destructive text-sm">{error.message}</p>;
  return <Form key={data.windowMinutes} saved={data} />;
}

function Form({ saved }: { saved: AwaySettings }) {
  const update = useUpdateAwaySettings();
  const [text, setText] = useState(String(saved.windowMinutes));
  const minutes = parseWindow(text);
  const error =
    minutes === null
      ? `A whole number from ${MIN_WINDOW_MINUTES} to ${MAX_WINDOW_MINUTES}`
      : null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (minutes === null) return;
        update.mutate(
          { windowMinutes: minutes },
          {
            onSuccess: () => toast.success("Away mode settings saved"),
            onError: (err) => toast.error(err.message),
          }
        );
      }}
      className="bg-muted/40 space-y-3 rounded-lg px-3 py-3"
    >
      <h3 className="text-sm font-medium">Away mode</h3>
      <p className="text-muted-foreground text-sm">
        Away mode works through orchestrators that were busy in this window, and
        only lists sessions with a real turn inside it. Older ones are left
        alone: a message wakes an agent and re-reads its whole conversation.
      </p>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">Recent means the last</span>
        <span className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            min={MIN_WINDOW_MINUTES}
            max={MAX_WINDOW_MINUTES}
            step={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Away window, minutes"
            aria-invalid={!!error}
            className="h-11 w-24 text-base sm:h-9 md:text-sm"
          />
          <span className="text-muted-foreground">min</span>
        </span>
      </label>
      {error && <p className="text-destructive text-xs">{error}</p>}
      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          className="h-11 sm:h-8"
          disabled={
            !!error || minutes === saved.windowMinutes || update.isPending
          }
        >
          Save
        </Button>
      </div>
    </form>
  );
}
