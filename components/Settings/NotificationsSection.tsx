"use client";

import { Button } from "@/components/ui/button";
import { PhoneNotifyForm } from "@/components/PhoneNotify/PhoneNotifyForm";
import type { NotificationSettings } from "@/lib/notifications";
import { SettingRow, SettingSection } from "./SettingRow";
import { SwitchSetting } from "./settings-fields";

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
      <SettingSection title="This browser">
        <SwitchSetting
          id="notify-sound"
          label="Sound"
          help="Play a sound when a session needs you or hits an error."
          checked={browser.settings.sound}
          defaultValue={true}
          onSave={async (sound) => browser.updateSettings({ sound })}
        />
        {browser.permissionGranted ? (
          <SwitchSetting
            id="notify-browser"
            label="Browser alerts"
            help="Show a system notification when a session needs you and AgentOS isn't in front."
            checked={browser.settings.browserNotifications}
            onSave={async (browserNotifications) =>
              browser.updateSettings({ browserNotifications })
            }
          />
        ) : (
          <SettingRow
            id="notify-browser"
            label="Browser alerts"
            help="This browser hasn't allowed AgentOS to show notifications."
            control={
              <Button
                size="sm"
                variant="outline"
                className="h-11 md:h-9"
                onClick={() => void browser.requestPermission()}
              >
                Allow
              </Button>
            }
          />
        )}
      </SettingSection>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Your phone</h3>
        <PhoneNotifyForm />
      </div>
    </div>
  );
}
