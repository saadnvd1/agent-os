"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { RefreshSettings } from "@/lib/chat/refresh";
import { useFreshStartQuery, useUpdateFreshStart } from "@/data/fresh-start";
import { parseFreshStart } from "./fresh-start";

// When a chat's agent starts a fresh conversation instead of carrying a
// long one: app-wide, one threshold for orchestrators and one for tasks.
export function FreshStartForm() {
  const { data, isPending, isError, error } = useFreshStartQuery();
  if (isPending)
    return <div className="bg-muted/40 h-24 animate-pulse rounded-lg" />;
  if (isError)
    return <p className="text-destructive text-sm">{error.message}</p>;
  return (
    <Form key={`${data.orchestratorTokens}:${data.taskTokens}`} saved={data} />
  );
}

function Form({ saved }: { saved: RefreshSettings }) {
  const update = useUpdateFreshStart();
  const orchestrator = useThreshold(saved.orchestratorTokens, 200);
  const task = useThreshold(saved.taskTokens, 200);
  const error = orchestrator.error ?? task.error;
  const dirty =
    !error &&
    (orchestrator.tokens !== saved.orchestratorTokens ||
      task.tokens !== saved.taskTokens);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (error) return;
        update.mutate(
          { orchestratorTokens: orchestrator.tokens, taskTokens: task.tokens },
          {
            onSuccess: () => toast.success("Fresh starts saved"),
            onError: (err) => toast.error(err.message),
          }
        );
      }}
      className="bg-muted/40 space-y-3 rounded-lg px-3 py-3"
    >
      <h3 className="text-sm font-medium">Fresh starts</h3>
      <p className="text-muted-foreground text-sm">
        When a conversation&apos;s context passes the threshold, its agent
        starts a new one at the next turn boundary, with its brief. An
        orchestrator also gets its rules and the workspace&apos;s current state,
        so nothing is lost. A task keeps only its brief and its branch.
      </p>
      <ThresholdRow label="Orchestrators" field={orchestrator} />
      <ThresholdRow label="Tasks" field={task} />
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

function useThreshold(tokens: number, fallbackK: number) {
  const [on, setOn] = useState(tokens > 0);
  const [text, setText] = useState(
    String(tokens > 0 ? tokens / 1000 : fallbackK)
  );
  const parsed = parseFreshStart(on, text);
  return {
    on,
    setOn,
    text,
    setText,
    tokens: "tokens" in parsed ? parsed.tokens : tokens,
    error: "error" in parsed ? parsed.error : null,
  };
}

function ThresholdRow({
  label,
  field,
}: {
  label: string;
  field: ReturnType<typeof useThreshold>;
}) {
  return (
    <div className="space-y-2">
      <label className="flex min-h-11 items-center justify-between gap-3 text-sm md:min-h-9">
        {label}
        <Switch
          checked={field.on}
          onCheckedChange={field.setOn}
          aria-label={`Fresh starts for ${label.toLowerCase()}`}
        />
      </label>
      {field.on && (
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">At</span>
          <span className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              min={50}
              step={10}
              value={field.text}
              onChange={(e) => field.setText(e.target.value)}
              aria-label={`${label} threshold, thousands of tokens`}
              aria-invalid={!!field.error}
              className="h-11 w-24 text-base sm:h-9 md:text-sm"
            />
            <span className="text-muted-foreground">k tokens</span>
          </span>
        </label>
      )}
    </div>
  );
}
