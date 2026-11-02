"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListSection } from "@/components/Settings/ListSection";
import { useDevicesQuery } from "@/data/devices";
import { AddDevicePanel } from "./AddDevicePanel";
import { DeviceGroupRow } from "./DeviceGroupRow";
import { DeviceRow } from "./DeviceRow";
import { groupDevices, type DeviceEntry } from "./group";
import { NetworkSection } from "./NetworkSection";
import { PasskeysSection } from "./PasskeysSection";

// A paired phone may use AgentOS but not add devices or open the network.
export const canManageDevices = (via: string | null | undefined) =>
  via === "loopback" || via === "tailnet";

// How devices reach this machine, its passkeys, then the devices paired to
// it. Settings > Devices & access.
export function DevicesPanel() {
  const { data, isPending, isError, error } = useDevicesQuery(true);
  const [adding, setAdding] = useState(false);
  const canManage = canManageDevices(data?.current.via);
  const { recent, older } = useMemo(
    () => groupDevices(data?.devices ?? [], data?.current.deviceId),
    [data]
  );
  const render = (e: DeviceEntry) =>
    e.kind === "group" ? (
      <DeviceGroupRow devices={e.devices} canManage={canManage} />
    ) : (
      <DeviceRow
        device={e.device}
        isCurrent={e.device.id === data?.current.deviceId}
        canManage={canManage}
      />
    );

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Access</h3>
        <NetworkSection open canManage={canManage} />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Passkeys</h3>
        <PasskeysSection open />
      </section>

      {adding && <AddDevicePanel onDone={() => setAdding(false)} />}
      {data && !data.push.linked && (
        <p className="text-muted-foreground text-sm">
          Phone push needs this machine linked to Connect. Until then,
          notifications go to Telegram if it&apos;s set up.
        </p>
      )}
      {data?.push.unavailable && (
        <p className="text-destructive text-sm">
          Push is paused: {data.push.unavailable}. Notifications go to Telegram
          meanwhile.
        </p>
      )}
      {isPending && (
        <div className="bg-muted/40 h-14 animate-pulse rounded-lg" />
      )}
      {isError && <p className="text-destructive text-sm">{error.message}</p>}
      {data && (
        <ListSection
          title="Devices"
          help={
            canManage
              ? "Phones, tablets and other computers paired to this AgentOS. Each is paired once and can be removed at any time."
              : "Add devices and change access on the machine running AgentOS, or over Tailscale."
          }
          items={recent}
          older={older}
          olderLabel="Not used for a month"
          keyOf={(e) => e.key}
          render={render}
          empty="No devices paired yet."
          action={
            canManage &&
            !adding && (
              <Button
                onClick={() => setAdding(true)}
                size="sm"
                className="h-11 sm:h-8"
              >
                <Plus className="h-4 w-4" />
                Add a device
              </Button>
            )
          }
        />
      )}
    </div>
  );
}
