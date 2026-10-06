"use client";

import { useState } from "react";
import { useSnapshot } from "valtio";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useDevicesQuery } from "@/data/devices";
import { devicesUi, devicesUiActions } from "@/stores/devicesUi";
import { AddDevicePanel } from "./AddDevicePanel";
import { DeviceRow } from "./DeviceRow";
import { NetworkSection } from "./NetworkSection";

export function DevicesDialog() {
  const { open } = useSnapshot(devicesUi);
  const { data, isPending, isError, error } = useDevicesQuery(open);
  const [adding, setAdding] = useState(false);
  // A paired phone may use AgentOS but not add devices or open the network.
  const via = data?.current.via;
  const canManage = via === "loopback" || via === "tailnet";

  const close = (o: boolean) => {
    devicesUiActions.setOpen(o);
    if (!o) setAdding(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Devices</DialogTitle>
          <DialogDescription>
            Phones, tablets and other computers that can use this AgentOS. Each
            one is paired once and can be removed at any time.
          </DialogDescription>
        </DialogHeader>

        {adding ? (
          <AddDevicePanel onDone={() => setAdding(false)} />
        ) : canManage ? (
          <Button
            onClick={() => setAdding(true)}
            className="h-11 w-full sm:h-9"
          >
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
          {isError && (
            <p className="text-destructive text-sm">{error.message}</p>
          )}
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
            />
          ))}
        </div>

        <p className="pt-2 text-sm font-medium">Access</p>
        <NetworkSection open={open} canManage={canManage} />
      </DialogContent>
    </Dialog>
  );
}
