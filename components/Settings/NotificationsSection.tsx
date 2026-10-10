"use client";

import { Button } from "@/components/ui/button";
import { PhoneNotifyForm } from "@/components/PhoneNotify/PhoneNotifyForm";
import type { NotificationSettings } from "@/lib/notifications";
import { SettingToggle } from "./SettingToggle";

// This browser's alerts live in the page (useNotifications), so they come in
// as props.
export interface BrowserNotifications {
  settings: NotificationSettings;
  permissionGranted: boolean;
  updateSettings: (settings: Partial<NotificationSettings>) => void;
  requestPermission: () => Promise<boolean>;
}

export function NotificationsSection({
  browser,
}: {
  browser: BrowserNotifications;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">This browser</h3>
        <SettingToggle
          title="Sound"
          detail="Play a sound when a session needs you or hits an error."
          checked={browser.settings.sound}
          onChange={(sound) => browser.updateSettings({ sound })}
        />
        {browser.permissionGranted ? (
          <SettingToggle
            title="Browser alerts"
            detail="Show a system notification when a session needs you and AgentOS isn't in front."
            checked={browser.settings.browserNotifications}
            onChange={(browserNotifications) =>
              browser.updateSettings({ browserNotifications })
            }
          />
        ) : (
          <div className="bg-muted/40 flex items-center gap-3 rounded-lg px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Browser alerts</p>
              <p className="text-muted-foreground text-xs">
                This browser hasn&rsquo;t allowed AgentOS to show notifications.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-11 md:h-8"
              onClick={() => void browser.requestPermission()}
            >
              Allow
            </Button>
          </div>
        )}
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Your phone</h3>
        <PhoneNotifyForm />
      </div>
    </div>
  );
}
