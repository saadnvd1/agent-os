"use client";

import { useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RuleRow } from "@/lib/orchestrator/rules";
import {
  useAddRule,
  useRemoveRule,
  useRulesQuery,
  useUpdateRule,
} from "@/data/orchestrators/rules";

const MAX_CHARS = 300;

// The orchestrator's standing rules for one workspace: what it keeps
// knowing across fresh starts. It adds them itself too; Saad edits here.
export function RulesForm({ workspaceId }: { workspaceId: string }) {
  const { data: rules, isPending, isError, error } = useRulesQuery(workspaceId);
  const add = useAddRule(workspaceId);
  const [text, setText] = useState("");

  return (
    <div className="space-y-2">
      <div className="text-sm">Orchestrator rules</div>
      {isPending ? (
        <div className="bg-muted/60 h-11 animate-pulse rounded-md" />
      ) : isError ? (
        <p className="text-destructive text-xs">{error.message}</p>
      ) : rules.length ? (
        <ul className="space-y-1">
          {rules.map((r) => (
            <RuleItem key={`${r.id}:${r.text}`} rule={r} />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-xs">
          None yet. The orchestrator keeps one when you tell it something
          standing, like a PR never to merge.
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          add.mutate(text, {
            onSuccess: () => setText(""),
            onError: (err) => toast.error(err.message),
          });
        }}
        className="flex items-center gap-2"
      >
        <Input
          value={text}
          maxLength={MAX_CHARS}
          onChange={(e) => setText(e.target.value)}
          placeholder="A PR never to merge, a URL, a house rule"
          aria-label="New orchestrator rule"
          className="h-11 text-base sm:h-9 md:text-sm"
        />
        <Button
          type="submit"
          size="sm"
          className="h-11 sm:h-8"
          disabled={!text.trim() || add.isPending}
        >
          Add
        </Button>
      </form>
    </div>
  );
}

function RuleItem({ rule }: { rule: RuleRow }) {
  const update = useUpdateRule(rule.workspace_id);
  const remove = useRemoveRule(rule.workspace_id);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(rule.text);

  if (editing)
    return (
      <li>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate(
              { id: rule.id, text },
              {
                onSuccess: () => setEditing(false),
                onError: (err) => toast.error(err.message),
              }
            );
          }}
          className="flex items-center gap-1"
        >
          <Input
            autoFocus
            value={text}
            maxLength={MAX_CHARS}
            onChange={(e) => setText(e.target.value)}
            aria-label={`Rule ${rule.id}`}
            className="h-11 text-base sm:h-9 md:text-sm"
          />
          <Button
            type="submit"
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 sm:size-8"
            disabled={!text.trim() || update.isPending}
            aria-label="Save rule"
          >
            <Check className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 sm:size-8"
            onClick={() => {
              setText(rule.text);
              setEditing(false);
            }}
            aria-label="Cancel"
          >
            <X className="size-4" />
          </Button>
        </form>
      </li>
    );

  return (
    <li className="bg-background/60 flex items-start gap-1 rounded-md py-1 pr-1 pl-2.5">
      <div className="min-w-0 flex-1 py-1.5">
        <p className="text-sm break-words">{rule.text}</p>
        <p className="text-muted-foreground text-xs">
          {rule.added_by === "saad" ? "You" : "Orchestrator"}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-11 shrink-0 sm:size-8"
        onClick={() => setEditing(true)}
        aria-label={`Edit rule: ${rule.text}`}
      >
        <Pencil className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-11 shrink-0 sm:size-8"
        disabled={remove.isPending}
        onClick={() =>
          remove.mutate(rule.id, {
            onError: (err) => toast.error(err.message),
          })
        }
        aria-label={`Remove rule: ${rule.text}`}
      >
        <Trash2 className="size-4" />
      </Button>
    </li>
  );
}
