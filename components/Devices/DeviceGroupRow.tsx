"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineConfirm } from "@/components/Settings/InlineConfirm";
import { useRevokeDevice } from "@/data/devices";
import type { ListedDevice } from "@/lib/security/devices";
import { DeviceIcon, lastSeen } from "./DeviceRow";

// Identical devices as one row, with one button to remove the lot.
export function DeviceGroupRow({
  devices,
  canManage,
}: {
  devices: ListedDevice[];
  canManage: boolean;
}) {
  const revoke = useRevokeDevice();
  const [asking, setAsking] = useState(false);
  const first = devices[0];
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-3">
        <DeviceIcon ua={first.user_agent} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {first.name}
            <span className="text-muted-foreground ml-1.5 font-normal tabular-nums">
              × {devices.length}
            </span>
          </p>
          <p className="text-muted-foreground truncate text-xs">
            Last used {lastSeen(first.last_seen_at)}
          </p>
        </div>
        {canManage && (
          <Button
            variant="ghost"
            size="sm"
            className="h-11 shrink-0 sm:h-8"
            onClick={() => setAsking(true)}
            disabled={revoke.isPending}
            aria-label={`Remove all ${devices.length} ${first.name} devices`}
          >
            <Trash2 className="h-4 w-4" />
            Remove all
          </Button>
        )}
      </div>
      {asking && (
        <InlineConfirm
          label={`Remove ${devices.length} ${first.name} devices`}
          message={`Remove all ${devices.length} devices called "${first.name}"? Each one has to be paired again to come back.`}
          confirmLabel={`Remove ${devices.length}`}
          onConfirm={() => {
            setAsking(false);
            for (const d of devices) revoke.mutate(d.id);
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </div>
  );
}
