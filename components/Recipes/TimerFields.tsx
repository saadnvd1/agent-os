"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  clock12,
  cronError,
  cronPreset,
  DEFAULT_TIMEZONE,
  describeCron,
  formatRunTime,
  isTimezone,
  MIN_GAP_MINUTES,
  minGapMinutes,
  nextRuns,
  presetCron,
  type PresetKind,
} from "@/lib/schedules/cron";
import type { RecipeTimer } from "@/lib/recipes/types";

type Mode = "off" | Exclude<PresetKind, "every"> | "custom";

const MODES: { value: Mode; label: string }[] = [
  { value: "off", label: "No timer" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "custom", label: "Custom" },
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const select =
  "border-input bg-background min-h-11 rounded-md border px-2 text-sm md:min-h-9";

export interface TimerValue {
  mode: Mode;
  hour: number;
  minute: number;
  weekday: number;
  custom: string;
  timezone: string;
}

export function timerValue(timer: RecipeTimer | null): TimerValue {
  const preset = timer ? cronPreset(timer.cron) : null;
  const mode: Mode = !timer
    ? "off"
    : preset && preset.kind !== "every"
      ? preset.kind
      : "custom";
  return {
    mode,
    hour: preset?.hour ?? 9,
    minute: preset?.minute ?? 0,
    weekday: preset?.weekday ?? 1,
    custom: timer?.cron ?? "0 9 * * 1-5",
    timezone: timer?.timezone ?? DEFAULT_TIMEZONE,
  };
}

export function timerCron(v: TimerValue): string | null {
  if (v.mode === "off") return null;
  if (v.mode === "custom") return v.custom.trim();
  return presetCron({
    kind: v.mode,
    hour: v.hour,
    minute: v.minute,
    weekday: v.weekday,
  });
}

// Why the timer can't be saved, or null.
export function timerProblem(v: TimerValue): string | null {
  const cron = timerCron(v);
  if (!cron) return null;
  if (!isTimezone(v.timezone)) return "Unknown time zone";
  const bad = cronError(cron);
  if (bad) return bad;
  return minGapMinutes(cron, v.timezone, Date.now(), MIN_GAP_MINUTES) <
    MIN_GAP_MINUTES
    ? "A recipe runs at most once an hour"
    : null;
}

export function TimerFields({
  value,
  onChange,
}: {
  value: TimerValue;
  onChange: (v: TimerValue) => void;
}) {
  const set = (patch: Partial<TimerValue>) => onChange({ ...value, ...patch });
  const cron = timerCron(value);
  const problem = timerProblem(value);
  const [openedAt] = useState(() => Date.now());
  const upcoming = useMemo(
    () => (cron && !problem ? nextRuns(cron, openedAt, 3, value.timezone) : []),
    [cron, problem, value.timezone, openedAt]
  );
  return (
    <div className="space-y-3">
      <div
        role="radiogroup"
        aria-label="Timer"
        className="bg-foreground/[0.04] grid grid-cols-3 gap-1 rounded-lg p-1 md:flex"
      >
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={value.mode === m.value}
            onClick={() => set({ mode: m.value })}
            className={cn(
              "min-h-11 min-w-0 flex-1 truncate rounded-md px-1 text-xs font-medium md:min-h-8 md:px-3 md:text-sm",
              value.mode === m.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      {value.mode === "weekly" && (
        <select
          aria-label="Day"
          className={select}
          value={value.weekday}
          onChange={(e) => set({ weekday: Number(e.target.value) })}
        >
          {DAYS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </select>
      )}
      {(value.mode === "daily" ||
        value.mode === "weekdays" ||
        value.mode === "weekly") && (
        <span className="ml-0 flex items-center gap-2">
          <select
            aria-label="Hour"
            className={select}
            value={value.hour}
            onChange={(e) => set({ hour: Number(e.target.value) })}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {clock12(h, 0).replace(":00", "")}
              </option>
            ))}
          </select>
          :
          <select
            aria-label="Minute"
            className={select}
            value={value.minute}
            onChange={(e) => set({ minute: Number(e.target.value) })}
          >
            {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
              <option key={m} value={m}>
                {String(m).padStart(2, "0")}
              </option>
            ))}
          </select>
        </span>
      )}
      {value.mode === "custom" && (
        <Input
          aria-label="Cron expression"
          className="font-mono"
          value={value.custom}
          onChange={(e) => set({ custom: e.target.value })}
        />
      )}
      {cron && (
        <p
          className={cn(
            "text-xs",
            problem ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {problem ??
            `${describeCron(cron)} · next ${upcoming
              .map((t) => formatRunTime(t, value.timezone))
              .join(", ")}`}
        </p>
      )}
    </div>
  );
}
