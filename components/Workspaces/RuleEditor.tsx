"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const MAX_RULE_CHARS = 300;

// The one editor for a rule, new or existing. Save and Cancel are here only
// while it's open, and Save waits for a real change.
export function RuleEditor({
  id,
  label,
  initial,
  saveLabel = "Save",
  placeholder,
  onSave,
  onCancel,
}: {
  id: string;
  label: string;
  initial: string;
  saveLabel?: string;
  placeholder?: string;
  // Throws to refuse; the editor stays open with what was typed.
  onSave: (text: string) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const next = text.trim();
  const canSave = !!next && next !== initial.trim() && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(next);
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <Textarea
        id={id}
        autoFocus
        rows={3}
        value={text}
        maxLength={MAX_RULE_CHARS}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
        }}
        className="text-base md:text-sm"
      />
      <div className="flex items-center justify-end gap-2">
        <span className="text-muted-foreground mr-auto text-xs tabular-nums">
          {text.length}/{MAX_RULE_CHARS}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-11 sm:h-9"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-11 sm:h-9"
          disabled={!canSave}
          onClick={() => void save()}
        >
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
