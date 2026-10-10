"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDevicesQuery } from "@/data/devices";
import { AddDevicePanel } from "./AddDevicePanel";
import { DeviceRow } from "./DeviceRow";
import { NetworkSection } from "./NetworkSection";
import { PasskeysSection } from "./PasskeysSection";

// A paired phone may use AgentOS but not add devices or open the network.
export const canManageDevices = (via: string | null | undefined) =>
  via === "loopback" || via === "tailnet";

// Phones, tablets and other computers that can use this AgentOS, its
// passkeys, and how they reach it. Settings > Devices & access.
export function DevicesPanel() {
  const { data, isPending, isError, error } = useDevicesQuery(true);
  const [adding, setAdding] = useState(false);
  const canManage = canManageDevices(data?.current.via);

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Phones, tablets and other computers that can use this AgentOS. Each one
        is paired once and can be removed at any time.
      </p>

      {adding ? (
        <AddDevicePanel onDone={() => setAdding(false)} />
      ) : canManage ? (
        <Button onClick={() => setAdding(true)} className="h-11 w-full sm:h-9">
          <Plus className="h-4 w-4" />
          Add a device
        </Button>
      ) : (
        data && (
          <p className="text-muted-foreground text-sm">
            Add devices and change access on the machine running AgentOS, or
            over Tailscale.
          </p>
        )
      )}

      <div className="space-y-2">
        {isPending && (
          <div className="bg-muted/40 h-14 animate-pulse rounded-lg" />
        )}
        {isError && <p className="text-destructive text-sm">{error.message}</p>}
        {data?.devices.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No devices paired yet.
          </p>
        )}
        {data?.devices.map((d) => (
          <DeviceRow
            key={d.id}
            device={d}
            isCurrent={d.id === data.current.deviceId}
            canManage={canManage}
          />
        ))}
      </div>

      <p className="pt-2 text-sm font-medium">Passkeys</p>
      <PasskeysSection open />

      <p className="pt-2 text-sm font-medium">Access</p>
      <NetworkSection open canManage={canManage} />
    </div>
  );
}
