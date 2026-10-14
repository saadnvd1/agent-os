"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_SUBAGENT_MODELS,
  mustNotBeHaiku,
  SUBAGENT_PATTERN,
  SUBAGENT_TIERS,
  TIER_LABELS,
  type SubagentModels as Map,
  type SubagentTier,
} from "@/lib/models/subagent-tiers";

// Which model each kind of subagent runs on (the Agent tool's
// subagent_type), for Claude sessions. Types that plan, decide or review
// can't be put on Haiku.
export function SubagentModels({
  saved,
  disabled,
  onChange,
}: {
  saved: Map | undefined;
  disabled: boolean;
  onChange: (next: Map) => void;
}) {
  const [adding, setAdding] = useState("");
  const rows = { ...DEFAULT_SUBAGENT_MODELS, ...saved };
  const valid = SUBAGENT_PATTERN.test(adding) && !(adding in rows);
  const set = (type: string, tier: SubagentTier) =>
    onChange({ ...saved, [type]: tier });

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Subagent models</h3>
      <p className="text-muted-foreground text-xs">
        Subagents a Claude session starts run on their own model by type: search
        on Haiku, anything that plans, decides or reviews on Sonnet. A new
        session picks a change up.
      </p>
      <ul className="space-y-2">
        {Object.entries(rows).map(([type, tier]) => {
          const custom = !(type in DEFAULT_SUBAGENT_MODELS);
          return (
            <li
              key={type}
              className="bg-muted/40 flex items-center gap-2 rounded-lg px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-sm">
                {type}
              </span>
              <Select
                value={tier}
                disabled={disabled}
                onValueChange={(v) => set(type, v as SubagentTier)}
              >
                <SelectTrigger
                  aria-label={`Model for ${type}`}
                  className="min-h-11 w-44"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBAGENT_TIERS.map((t) => (
                    <SelectItem
                      key={t}
                      value={t}
                      disabled={t === "haiku" && mustNotBeHaiku(type)}
                    >
                      {TIER_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(custom || saved?.[type] !== undefined) && (
                <Button
                  variant="ghost"
                  className="min-h-11"
                  disabled={disabled}
                  onClick={() => {
                    const next = { ...saved };
                    delete next[type];
                    onChange(next);
                  }}
                >
                  {custom ? "Remove" : "Reset"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        <Input
          value={adding}
          onChange={(e) => setAdding(e.target.value.trim())}
          placeholder="Another type, or prefix*"
          aria-label="Subagent type to add"
          className="min-h-11"
        />
        <Button
          variant="secondary"
          className="min-h-11"
          disabled={disabled || !valid}
          onClick={() => {
            set(adding, "inherit");
            setAdding("");
          }}
        >
          Add
        </Button>
      </div>
    </section>
  );
}
