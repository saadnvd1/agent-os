"use client";

import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SettingSection } from "@/components/Settings/SettingRow";
import { TextSetting } from "@/components/Settings/settings-fields";
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
// Every change takes his passkey (data/orchestrators/rules), so a rule saves
// on Enter or its button, never on blur; a cancelled or refused passkey rolls
// the row back like any failed save.
export function RulesForm({ workspaceId }: { workspaceId: string }) {
  const { data: rules, isPending, isError, error } = useRulesQuery(workspaceId);
  const add = useAddRule(workspaceId);

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Orchestrator rules</p>
      {isPending ? (
        <div className="bg-muted/60 h-11 animate-pulse rounded-md" />
      ) : isError ? (
        <p className="text-destructive text-xs">{error.message}</p>
      ) : (
        <SettingSection
          help={
            rules.length
              ? "Each change asks for your passkey."
              : "None yet. The orchestrator keeps one when you tell it something standing, like a PR never to merge. Each change asks for your passkey."
          }
        >
          {rules.map((r) => (
            <RuleItem key={`${r.id}:${r.text}`} rule={r} />
          ))}
          <TextSetting
            id={`rule-new-${workspaceId}`}
            label="New rule"
            value=""
            explicit
            resettable={false}
            buttonLabel="Add"
            maxLength={MAX_CHARS}
            placeholder="A PR never to merge, a URL, a house rule"
            onSave={(text) => add.mutateAsync(text)}
          />
        </SettingSection>
      )}
    </div>
  );
}

function RuleItem({ rule }: { rule: RuleRow }) {
  const update = useUpdateRule(rule.workspace_id);
  const remove = useRemoveRule(rule.workspace_id);
  return (
    <TextSetting
      id={`rule-${rule.id}`}
      label={rule.added_by === "saad" ? "Your rule" : "Orchestrator's rule"}
      value={rule.text}
      explicit
      resettable={false}
      buttonLabel="Save"
      maxLength={MAX_CHARS}
      validate={(text) => (text ? null : "A rule can't be empty")}
      onSave={(text) => update.mutateAsync({ id: rule.id, text })}
      after={
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
      }
    />
  );
}
