"use client";

import { Switch } from "@/components/ui/switch";
import { useNetworkQuery, useUpdateNetwork } from "@/data/devices";
import { TailscaleCard } from "./TailscaleCard";

function Toggle({
  title,
  detail,
  checked,
  locked,
  onChange,
}: {
  title: string;
  detail: string;
  checked: boolean;
  locked: boolean;
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

export function NetworkSection({
  open,
  canManage,
}: {
  open: boolean;
  canManage: boolean;
}) {
  const { data, isPending, isError, error } = useNetworkQuery(open);
  const update = useUpdateNetwork();

  if (isPending)
    return <div className="bg-muted/40 h-32 animate-pulse rounded-lg" />;
  if (isError)
    return <p className="text-destructive text-sm">{error.message}</p>;

  return (
    <div className="space-y-2">
      <TailscaleCard tailscale={data.tailscale} />
      <Toggle
        title="Allow devices on this Wi-Fi"
        detail="Paired devices on the same network can connect. Use it on networks you trust: Wi-Fi traffic isn't encrypted."
        checked={data.lan.on}
        locked={data.lan.locked || !canManage}
        onChange={(lan) => update.mutate({ lan })}
      />
      <Toggle
        title="Require pairing on Tailscale too"
        detail="By default anything on your tailnet is trusted. Turn this on if others share your tailnet."
        checked={data.requirePairingOnTailnet.on}
        locked={data.requirePairingOnTailnet.locked || !canManage}
        onChange={(requirePairingOnTailnet) =>
          update.mutate({ requirePairingOnTailnet })
        }
      />
      {update.error && (
        <p className="text-destructive text-xs">{update.error.message}</p>
      )}
    </div>
  );
}
