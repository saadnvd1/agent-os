"use client";

import { useFreshStartQuery, useUpdateFreshStart } from "@/data/fresh-start";
import type { RefreshSettings } from "@/lib/chat/refresh";
import {
  MAX_REFRESH_TOKENS,
  MIN_REFRESH_TOKENS,
} from "@/lib/chat/refresh-limits";
import {
  SETTING_DEFAULTS,
  freshOnValue,
  type FreshKey,
} from "@/lib/settings/defaults";
import { SettingSection } from "./SettingRow";
import { NumberSetting } from "./settings-fields";

type Row = {
  key: keyof RefreshSettings & FreshKey;
  label: string;
  help: string;
};

const FRESH: Row[] = [
  {
    key: "orchestratorTokens",
    label: "Orchestrators",
    help: "Start fresh past this size, at the next turn. Its brief, rules and the workspace's state carry over.",
  },
  {
    key: "taskTokens",
    label: "Tasks",
    help: "A task keeps only its brief and its branch.",
  },
];

const COMPACT: Row[] = [
  {
    key: "autoCompactTokens",
    label: "Mid-turn, tasks",
    help: "A task's agent compacts itself while a job runs long. Keep it high: it is holding its files.",
  },
  {
    key: "interactiveAutoCompactTokens",
    label: "Mid-turn, your sessions",
    help: "Your own chats and terminals. A terminal only gets this one.",
  },
  {
    key: "compactTokens",
    label: "Between turns",
    help: "Compact chats and tasks before the next message. The composer offers first.",
  },
];

// When agents start fresh or compact: app-wide, each value saved on its own.
export function ContextSection() {
  const { data, isPending, isError, error } = useFreshStartQuery();
  const update = useUpdateFreshStart();
  if (isPending)
    return <div className="bg-muted/40 h-24 animate-pulse rounded-xl" />;
  if (isError)
    return <p className="text-destructive text-sm">{error.message}</p>;

  const row = ({ key, label, help }: Row) => (
    <NumberSetting
      key={key}
      id={`context-${key}`}
      label={label}
      help={help}
      value={data[key]}
      defaultValue={SETTING_DEFAULTS.fresh[key]}
      onSave={(n) => update.mutateAsync({ [key]: n })}
      min={MIN_REFRESH_TOKENS}
      max={MAX_REFRESH_TOKENS}
      scale={1000}
      unit="k tokens"
      short="k"
      optional={{ off: 0, on: freshOnValue(key) }}
    />
  );
  return (
    <div className="space-y-1">
      <SettingSection
        title="Fresh starts"
        help="When a conversation passes the size, its agent starts a new one with its brief."
      >
        {FRESH.map(row)}
      </SettingSection>
      <SettingSection
        title="Compact"
        help="Mid-turn, Claude Code summarizes itself; between turns, AgentOS compacts before the next message. AgentOS hands the task, files and todos back."
      >
        {COMPACT.map(row)}
      </SettingSection>
    </div>
  );
}
