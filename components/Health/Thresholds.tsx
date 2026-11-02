"use client";

import { SettingSection } from "@/components/Settings/SettingRow";
import {
  NumberSetting,
  SwitchSetting,
} from "@/components/Settings/settings-fields";
import { useHealthConfig, useSaveConfig } from "@/data/health";

// When each check trips. The server says how every one reads (label, unit,
// range, switch), so a new threshold shows up here without a client change.
export function Thresholds() {
  const { data } = useHealthConfig();
  const save = useSaveConfig();
  if (!data) return null;
  return (
    <div className="space-y-3">
      <SettingSection>
        {Object.keys(data.defaults).map((k) => {
          const meta = data.meta[k];
          const put = (n: number) => save.mutateAsync({ [k]: n });
          return meta.switch ? (
            <SwitchSetting
              key={k}
              id={`health-${k}`}
              label={meta.label}
              help="Off, anomalies still open and reach the chat, but nothing wakes to look at them."
              checked={data.config[k] !== 0}
              defaultValue={data.defaults[k] !== 0}
              onSave={(on) => put(on ? 1 : 0)}
            />
          ) : (
            <NumberSetting
              key={k}
              id={`health-${k}`}
              label={meta.label}
              value={data.config[k]}
              defaultValue={data.defaults[k]}
              min={meta.min}
              max={meta.max}
              integer={meta.integer ?? true}
              unit={meta.unit}
              onSave={put}
            />
          );
        })}
      </SettingSection>
    </div>
  );
}
