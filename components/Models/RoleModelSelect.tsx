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
import { AvailabilityDot, LocalityBadge } from "./ModelBadges";

const INHERIT = "__inherit";

function Row({ choice }: { choice: ModelChoice }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <AvailabilityDot availability={choice.availability} />
      <span className="truncate">{choice.label}</span>
      <LocalityBadge locality={choice.locality} />
    </span>
  );
}

// A model picker over the server's list: grouped by provider, each model
// labelled Local or Cloud with whether its server answers. `claudeOnly`
// leaves out the models that run through Pi.
export function RoleModelSelect({
  id,
  value,
  inheritLabel,
  claudeOnly,
  gateOnly,
  disabled,
  onChange,
}: {
  id?: string;
  value: string | null;
  inheritLabel: string;
  claudeOnly?: boolean;
  // Only models that can serve a merge gate are selectable.
  gateOnly?: boolean;
  disabled?: boolean;
  onChange: (ref: string | null) => void;
}) {
  const { data } = useModelChoices();
  const choices = (data ?? []).filter((c) => !claudeOnly || c.agent !== "pi");
  const groups = [...new Set(choices.map((c) => c.group))];
  const current = value ? choices.find((c) => c.ref === value) : undefined;
  return (
    <Select
      value={value ?? INHERIT}
      onValueChange={(v) => onChange(v === INHERIT ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id} className="h-11 md:h-9">
        <SelectValue>
          {current ? <Row choice={current} /> : (value ?? inheritLabel)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={INHERIT}>{inheritLabel}</SelectItem>
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
                  disabled={gateOnly && !c.gateCapable}
                  className="min-h-11 md:min-h-0"
                >
                  <Row choice={c} />
                </SelectItem>
              ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
