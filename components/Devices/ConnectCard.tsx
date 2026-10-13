"use client";

import { Cloud } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { ConnectStatus } from "@/lib/connect/serve";
import { CONNECT_STATE as STATE, connectView } from "@/lib/connect/view";

export function ConnectCard({
  connect,
  canManage,
  onToggle,
}: {
  connect: ConnectStatus;
  canManage: boolean;
  onToggle: (on: boolean) => void;
}) {
  const { linked: enrolled, on } = connectView(connect);
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
          {connect.hostname ? (
            <>
              Reachable from anywhere at{" "}
              <span className="text-foreground font-mono">
                https://{connect.hostname}
              </span>
              . Cloudflare carries the connection; every request still needs a
              paired device.
            </>
          ) : enrolled ? (
            <>Linked. The address appears once the tunnel starts.</>
          ) : (
            <>Not set up on this machine. Run agent-os connect in a terminal.</>
          )}
          {connect.reason && connect.state !== "off"
            ? ` ${connect.reason.replace(/\.$/, "")}.`
            : ""}
        </p>
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
