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
import { TWO_LINE_TRIGGER, ValueLabel } from "@/components/Settings/ValueLabel";
import { modelChoices } from "@/data/models";
import type { EffectiveModels } from "@/lib/models/config";

const INHERIT = "__inherit";

// A "provider/model" picker over every enabled provider's models, grouped
// by provider. With `inheritLabel`, a first option that clears it.
export function ModelSelect({
  id,
  value,
  effective,
  inheritLabel,
  inheritDetail,
  disabled,
  onChange,
}: {
  id?: string;
  value: string | null;
  effective: EffectiveModels | undefined;
  inheritLabel?: string;
  inheritDetail?: string;
  disabled?: boolean;
  onChange: (ref: string | null) => void;
}) {
  const choices = modelChoices(effective);
  const groups = [...new Set(choices.map((c) => c.provider))];
  // A saved model no provider lists any more still shows as itself.
  const missing = value && !choices.some((c) => c.ref === value);
  return (
    <Select
      value={value ?? INHERIT}
      onValueChange={(v) => onChange(v === INHERIT ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id} className={TWO_LINE_TRIGGER}>
        <SelectValue>
          {value === null && inheritLabel ? (
            <ValueLabel label={inheritLabel} detail={inheritDetail} />
          ) : (
            (choices.find((c) => c.ref === value)?.label ?? value)
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {inheritLabel && (
          <SelectItem value={INHERIT}>
            <ValueLabel label={inheritLabel} detail={inheritDetail} />
          </SelectItem>
        )}
        {missing && <SelectItem value={value}>{value}</SelectItem>}
        {groups.map((g) => (
          <SelectGroup key={g}>
            <SelectLabel>{g}</SelectLabel>
            {choices
              .filter((c) => c.provider === g)
              .map((c) => (
                <SelectItem key={c.ref} value={c.ref}>
                  {c.label}
                </SelectItem>
              ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
