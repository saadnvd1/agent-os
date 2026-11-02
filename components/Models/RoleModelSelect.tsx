"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useModelChoices } from "@/data/models";
import type { ModelChoice } from "@/lib/models/catalog";
import { TWO_LINE_TRIGGER, ValueLabel } from "@/components/Settings/ValueLabel";
import { AvailabilityDot, LocalityBadge } from "./ModelBadges";

const INHERIT = "__inherit";

function Row({ choice, why }: { choice: ModelChoice; why?: string | null }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex min-w-0 items-center gap-2">
        <AvailabilityDot availability={choice.availability} />
        <span className="truncate">{choice.label}</span>
        <LocalityBadge locality={choice.locality} />
      </span>
      {why && (
        <span className="text-muted-foreground text-xs whitespace-normal">
          {why}
        </span>
      )}
    </span>
  );
}

// A model picker over the server's list: grouped by provider, each model
// labelled Local or Cloud with whether its server answers. `claudeOnly`
// leaves out the models that run through Pi. `blockedBy` greys a model with
// the reason it can't be picked instead of hiding it; a model whose provider
// isn't set up is always greyed.
export function RoleModelSelect({
  id,
  value,
  inheritLabel,
  inheritDetail,
  claudeOnly,
  gateOnly,
  blockedBy,
  disabled,
  onChange,
}: {
  id?: string;
  value: string | null;
  inheritLabel: string;
  // What the inherited choice resolves to (a model id), shown under it.
  inheritDetail?: string;
  claudeOnly?: boolean;
  // Only models that can serve a merge gate are selectable.
  gateOnly?: boolean;
  blockedBy?: (c: ModelChoice) => string | null;
  disabled?: boolean;
  onChange: (ref: string | null) => void;
}) {
  const { data } = useModelChoices();
  const choices = (data ?? []).filter((c) => !claudeOnly || c.agent !== "pi");
  const whyNot = (c: ModelChoice) =>
    c.unusable ??
    blockedBy?.(c) ??
    (gateOnly && !c.gateCapable ? "Can't serve a merge gate" : null);
  const groups = [...new Set(choices.map((c) => c.group))];
  const current = value ? choices.find((c) => c.ref === value) : undefined;
  return (
    <Select
      value={value ?? INHERIT}
      onValueChange={(v) => onChange(v === INHERIT ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id} className={TWO_LINE_TRIGGER}>
        <SelectValue>
          {current ? (
            <Row choice={current} />
          ) : value ? (
            <ValueLabel label={value} />
          ) : (
            <ValueLabel label={inheritLabel} detail={inheritDetail} />
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={INHERIT}>
          <ValueLabel label={inheritLabel} detail={inheritDetail} />
        </SelectItem>
        {value && !current && <SelectItem value={value}>{value}</SelectItem>}
        {groups.map((g) => (
          <SelectGroup key={g}>
            <SelectLabel>{g}</SelectLabel>
            {choices
              .filter((c) => c.group === g)
              .map((c) => (
                <SelectItem
                  key={c.ref}
                  value={c.ref}
                  disabled={!!whyNot(c)}
                  className="min-h-11 md:min-h-0"
                >
                  <Row choice={c} why={whyNot(c)} />
                </SelectItem>
              ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
