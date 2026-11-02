"use client";

import { SettingSection } from "@/components/Settings/SettingRow";
import { SwitchSetting } from "@/components/Settings/settings-fields";
import { useNetworkQuery, useUpdateNetwork } from "@/data/devices";
import { TailscaleCard } from "./TailscaleCard";
import { ConnectCard } from "./ConnectCard";
import { ReachRow } from "@/components/Reach/ReachRow";

// How devices reach this machine: Connect, Wi-Fi and Tailscale.
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
      <ReachRow enabled={open} />
      <SettingSection>
        <ConnectCard
          connect={data.connect}
          canManage={canManage}
          onToggle={(connect) => update.mutateAsync({ connect })}
        />
        <TailscaleCard tailscale={data.tailscale} />
        <SwitchSetting
          id="network-lan"
          label="Allow devices on this Wi-Fi"
          help="Paired devices on the same network can connect. Use it on networks you trust: Wi-Fi traffic isn't encrypted."
          checked={data.lan.on}
          locked={data.lan.locked || !canManage}
          onSave={(lan) => update.mutateAsync({ lan })}
        />
        <SwitchSetting
          id="network-tailnet-pairing"
          label="Require pairing on Tailscale too"
          help="By default anything on your tailnet is trusted. Turn this on if others share your tailnet."
          checked={data.requirePairingOnTailnet.on}
          locked={data.requirePairingOnTailnet.locked || !canManage}
          onSave={(requirePairingOnTailnet) =>
            update.mutateAsync({ requirePairingOnTailnet })
          }
        />
      </SettingSection>
    </div>
  );
}
