"use client";

import { useState } from "react";
import { Bell, Laptop, Smartphone } from "lucide-react";
import { Block } from "./Block";
import { ConnectBlock } from "./ConnectBlock";
import { AddDevicePanel } from "@/components/Devices/AddDevicePanel";
import {
  NotificationsSection,
  type BrowserNotifications,
} from "@/components/Settings/NotificationsSection";
import { Button } from "@/components/ui/button";

/**
 * Pair a phone, link another machine, set up notifications. Every part is
 * optional and lives in Settings too.
 */
export function DevicesStep({
  notifications,
  onLinkMachine,
}: {
  notifications: BrowserNotifications;
  onLinkMachine: () => void;
}) {
  const [pairing, setPairing] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Block
        icon={Smartphone}
        title="Pair your phone"
        detail="Scan a code to use AgentOS from your phone on this network."
      >
        {pairing ? (
          <AddDevicePanel onDone={() => setPairing(false)} />
        ) : (
          <Button
            variant="outline"
            className="min-h-11 sm:min-h-9"
            onClick={() => setPairing(true)}
          >
            Show pairing code
          </Button>
        )}
      </Block>
      <ConnectBlock />
      <Block
        icon={Laptop}
        title="Link another machine"
        detail="Run sessions on a server or second computer over ssh."
      >
        <Button
          variant="outline"
          className="min-h-11 sm:min-h-9"
          onClick={onLinkMachine}
        >
          Add a machine
        </Button>
      </Block>
      <Block
        icon={Bell}
        title="Notifications"
        detail="Hear when a session needs you."
      >
        <NotificationsSection browser={notifications} />
      </Block>
    </div>
  );
}
