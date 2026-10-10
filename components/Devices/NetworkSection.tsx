"use client";

import { SettingToggle as Toggle } from "@/components/Settings/SettingToggle";
import { useNetworkQuery, useUpdateNetwork } from "@/data/devices";
import { TailscaleCard } from "./TailscaleCard";
import { ConnectCard } from "./ConnectCard";

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
      <ConnectCard
        connect={data.connect}
        canManage={canManage}
        onToggle={(connect) => update.mutate({ connect })}
      />
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
