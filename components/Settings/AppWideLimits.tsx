"use client";

import { useAwaySettingsQuery, useUpdateAwaySettings } from "@/data/away";
import { useStallQuery, useUpdateStall } from "@/data/stall";
import { MAX_STALL_MINUTES, MIN_STALL_MINUTES } from "@/lib/chat/stall-limits";
import {
  MAX_WINDOW_MINUTES,
  MIN_WINDOW_MINUTES,
} from "@/lib/away/window-limits";
import { SETTING_DEFAULTS } from "@/lib/settings/defaults";
import { SettingSection } from "./SettingRow";
import { NumberSetting } from "./settings-fields";

// Stall alerts and the Away window: app-wide, each saved on its own.
export function AppWideLimits() {
  const stall = useStallQuery();
  const away = useAwaySettingsQuery();
  const updateStall = useUpdateStall();
  const updateAway = useUpdateAwaySettings();
  return (
    <SettingSection
      title="Alerts and Away"
      help="Apply across every workspace."
    >
      {stall.data && (
        <NumberSetting
          id="stall-minutes"
          label="Flag stalled turns"
          help="Warn, and tell the orchestrator, when a turn makes no progress for this long."
          value={stall.data.minutes}
          defaultValue={SETTING_DEFAULTS.stallMinutes}
          onSave={(n) => updateStall.mutateAsync(n)}
          min={MIN_STALL_MINUTES}
          max={MAX_STALL_MINUTES}
          unit="minutes"
          short=" min"
          optional={{ off: 0, on: SETTING_DEFAULTS.stallMinutes }}
        />
      )}
      {away.data && (
        <NumberSetting
          id="away-window"
          label="Away window"
          help="Away mode only works through sessions with a real turn this recently."
          value={away.data.windowMinutes}
          defaultValue={SETTING_DEFAULTS.awayWindowMinutes}
          onSave={(n) => updateAway.mutateAsync({ windowMinutes: n })}
          min={MIN_WINDOW_MINUTES}
          max={MAX_WINDOW_MINUTES}
          unit="minutes"
          short=" min"
        />
      )}
      {(stall.isError || away.isError) && (
        <p className="text-destructive px-3 py-2 text-sm">
          {stall.error?.message ?? away.error?.message}
        </p>
      )}
    </SettingSection>
  );
}
