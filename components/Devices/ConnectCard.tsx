"use client";

import { Cloud } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { ConnectStatus } from "@/lib/connect/serve";

const STATE: Record<ConnectStatus["state"], string> = {
  up: "Connected",
  connecting: "Connecting…",
  denied: "Refused by the relay",
  off: "Off",
  refused: "Not running here",
  error: "Problem",
};

export function ConnectCard({
  connect,
  canManage,
  onToggle,
}: {
  connect: ConnectStatus;
  canManage: boolean;
  onToggle: (on: boolean) => void;
}) {
  const enrolled = !!connect.hostname;
  const on =
    connect.state === "up" ||
    connect.state === "connecting" ||
    connect.state === "denied";
  return (
    <div className="bg-muted/40 flex items-start gap-3 rounded-lg px-3 py-2.5">
      <Cloud className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          Connect{" "}
          <span className="text-muted-foreground font-normal">
            · {STATE[connect.state]}
          </span>
        </p>
        <p className="text-muted-foreground text-xs break-all">
          {enrolled ? (
            <>
              Reachable from anywhere at{" "}
              <span className="text-foreground font-mono">
                https://{connect.hostname}
              </span>
              . The relay passes encrypted traffic through and can&apos;t read
              it.
            </>
          ) : (
            <>Not set up on this machine. Run agent-os connect in a terminal.</>
          )}
          {connect.reason && connect.state !== "off"
            ? ` ${connect.reason}.`
            : ""}
        </p>
        {connect.cert?.warning && (
          <p className="text-destructive mt-1 text-xs">
            {connect.cert.warning}
          </p>
        )}
      </div>
      {enrolled && (
        <Switch
          checked={on}
          disabled={!canManage || connect.state === "refused"}
          onCheckedChange={onToggle}
          className="mt-0.5"
          aria-label="Connect"
        />
      )}
    </div>
  );
}
