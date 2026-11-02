"use client";

import { useContext, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import {
  matchesQuery,
  SettingBlock,
  SettingSection,
  SettingsQueryContext,
} from "@/components/Settings/SettingRow";
import type { RuleRow } from "@/lib/orchestrator/rules";
import {
  useAddRule,
  useRemoveRule,
  useRulesQuery,
  useUpdateRule,
} from "@/data/orchestrators/rules";
import { RuleEditor } from "./RuleEditor";

const ROW = "border-foreground/5 border-t px-3 py-2 first:border-t-0";

// The orchestrator's standing rules for one workspace: what it keeps
// knowing across fresh starts. It adds them itself too; Saad edits here.
// Every add, edit and remove takes his passkey (data/orchestrators/rules), so
// nothing saves until Save, never on blur; a cancelled or refused passkey
// leaves the editor open with what was typed.
export function RulesForm({ workspaceId }: { workspaceId: string }) {
  const { data: rules, isPending, isError, error } = useRulesQuery(workspaceId);
  const add = useAddRule(workspaceId);
  const [adding, setAdding] = useState(false);
  const query = useContext(SettingsQueryContext);

  return (
    <SettingSection
      title="Rules"
      help="What the orchestrator keeps across fresh starts, like a PR never to merge. Each change asks for your passkey."
    >
      {isPending ? (
        <div className="bg-muted/60 m-3 h-11 animate-pulse rounded-md" />
      ) : isError ? (
        <p className="text-destructive px-3 py-2 text-sm">{error.message}</p>
      ) : (
        <>
          {rules.length === 0 && !adding && (
            <SettingBlock id={`rules-none-${workspaceId}`} label="Rules">
              <p className="text-muted-foreground text-xs">None yet.</p>
            </SettingBlock>
          )}
          {rules.map((r) => (
            <RuleItem key={`${r.id}:${r.text}`} rule={r} />
          ))}
          {matchesQuery(query, "add rule") && (
            <div data-setting={`rule-new-${workspaceId}`} className={ROW}>
              {adding ? (
                <RuleEditor
                  id={`rule-new-${workspaceId}`}
                  label="New rule"
                  initial=""
                  saveLabel="Add rule"
                  placeholder="A PR never to merge, a URL, a house rule"
                  onSave={async (text) => {
                    try {
                      await add.mutateAsync(text);
                    } catch (err) {
                      toast.error(
                        err instanceof Error ? err.message : "Couldn't add"
                      );
                      throw err;
                    }
                    setAdding(false);
                  }}
                  onCancel={() => setAdding(false)}
                />
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-primary -ml-2 h-11 sm:h-9"
                  onClick={() => setAdding(true)}
                >
                  <Plus className="size-4" />
                  Add rule
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </SettingSection>
  );
}

function RuleItem({ rule }: { rule: RuleRow }) {
  const update = useUpdateRule(rule.workspace_id);
  const remove = useRemoveRule(rule.workspace_id);
  const [editing, setEditing] = useState(false);
  const query = useContext(SettingsQueryContext);
  if (!matchesQuery(query, rule.text)) return null;

  return (
    <div data-setting={`rule-${rule.id}`} className={ROW}>
      {editing ? (
        <RuleEditor
          id={`rule-${rule.id}`}
          label="Edit rule"
          initial={rule.text}
          onSave={async (text) => {
            try {
              await update.mutateAsync({ id: rule.id, text });
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Couldn't save");
              throw err;
            }
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="flex items-start gap-1">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="hover:bg-muted/60 -my-1 min-h-11 min-w-0 flex-1 cursor-pointer rounded-md px-2 py-1 text-left"
          >
            <StatusPill
              tone={rule.added_by === "saad" ? "primary" : "muted"}
              className="mb-1"
            >
              {rule.added_by === "saad" ? "You" : "Orchestrator"}
            </StatusPill>
            <span className="block text-sm break-words whitespace-pre-wrap">
              {rule.text}
            </span>
          </button>
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
        </div>
      )}
    </div>
  );
}
