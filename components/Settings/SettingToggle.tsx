"use client";

import { Switch } from "@/components/ui/switch";

// One labelled switch on a Settings page; a locked one says so.
export function SettingToggle({
  title,
  detail,
  checked,
  locked,
  onChange,
}: {
  title: string;
  detail: string;
  checked: boolean;
  locked?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="bg-muted/40 flex items-start gap-3 rounded-lg px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground text-xs">
          {detail}
          {locked ? " Can't be changed from here." : ""}
        </p>
      </div>
      <Switch
        checked={checked}
        disabled={locked}
        onCheckedChange={onChange}
        className="mt-0.5"
      />
    </label>
  );
}
