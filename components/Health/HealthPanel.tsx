"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useAddNote,
  useDeleteNote,
  useDismissAnomaly,
  useHealthConfig,
  useHealthNotes,
  useHealthQuery,
  useSaveConfig,
} from "@/data/health";
import { AREAS, AREA_LABELS, type Area } from "@/lib/health/types";
import {
  duration,
  type AnomalyView,
  type CheckSummary,
} from "@/lib/health/view";
import { cn } from "@/lib/utils";

const TABS = ["open", "history", "notes", "thresholds"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  open: "Open",
  history: "History",
  notes: "Notes",
  thresholds: "Thresholds",
};

const tokens = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

function dot(a: AnomalyView): string {
  if (a.needsYou) return "bg-destructive";
  if (a.verdict && !a.verdict.real) return "bg-green-500";
  return a.severity === "high" ? "bg-destructive" : "bg-amber-500";
}

function Chip({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "red" | "amber";
}) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[11px]",
        tone === "red"
          ? "bg-destructive/10 text-destructive"
          : tone === "amber"
            ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
            : "bg-muted text-muted-foreground"
      )}
    >
      {children}
    </span>
  );
}

function Row({
  a,
  now,
  onDismiss,
}: {
  a: AnomalyView;
  now: number;
  onDismiss?: () => void;
}) {
  const v = a.verdict;
  const end = a.closedAt ?? now;
  return (
    <li
      data-anomaly={a.id}
      className="border-border/60 flex gap-3 border-b px-3 py-3 last:border-b-0"
    >
      <span
        className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", dot(a))}
        aria-hidden
      />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium break-words">
          {AREA_LABELS[a.area]} · {a.line}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {a.needsYou && <Chip tone="red">needs you</Chip>}
          {a.severity === "high" && !a.needsYou && (
            <Chip tone="amber">high</Chip>
          )}
          {v?.unjudged && <Chip>unjudged</Chip>}
          {a.judging && <Chip>judging…</Chip>}
          {v && !v.real && <Chip>judged normal</Chip>}
          <span className="text-muted-foreground text-xs">
            {a.check} ·{" "}
            {a.closedAt
              ? `open ${duration(end - a.openedAt)}`
              : `open ${duration(end - a.openedAt)} so far`}
            {a.closedAt ? ` · ${a.closeReason}` : ""}
            {a.tokens > 0 ? ` · ${tokens(a.tokens)} tokens` : ""}
          </span>
        </div>
        {v && !v.unjudged && <p className="text-sm break-words">{v.cause}</p>}
        {v?.real && v.action && !v.unjudged && (
          <p className="text-muted-foreground text-sm break-words">
            Suggest: <span className="text-foreground">{v.action}</span>
          </p>
        )}
        {v?.unjudged && v.why && (
          <p className="text-muted-foreground text-xs">No watcher: {v.why}</p>
        )}
      </div>
      {onDismiss && (
        <Button
          variant="outline"
          size="sm"
          className="h-11 shrink-0 self-start md:h-8"
          onClick={onDismiss}
        >
          Dismiss
        </Button>
      )}
    </li>
  );
}

function List({
  items,
  now,
  empty,
  onDismiss,
}: {
  items: AnomalyView[];
  now: number;
  empty: string;
  onDismiss?: (id: number) => void;
}) {
  if (!items.length)
    return (
      <p className="text-muted-foreground border-border/60 rounded-xl border px-3 py-6 text-center text-sm">
        {empty}
      </p>
    );
  return (
    <ul className="border-border/60 overflow-hidden rounded-xl border">
      {items.map((a) => (
        <Row
          key={a.id}
          a={a}
          now={now}
          onDismiss={onDismiss && (() => onDismiss(a.id))}
        />
      ))}
    </ul>
  );
}

function Summary({ rows }: { rows: CheckSummary[] }) {
  if (!rows.length) return null;
  const sum = (f: (r: CheckSummary) => number) =>
    rows.reduce((n, r) => n + f(r), 0);
  return (
    <div className="space-y-2">
      <h3 className="label-mono text-muted-foreground">Last 7 days</h3>
      <div className="border-border/60 overflow-x-auto rounded-xl border">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-muted-foreground text-xs">
            <tr className="border-border/60 border-b">
              <th className="px-3 py-2 text-left font-medium">Check</th>
              <th className="px-3 py-2 text-right font-medium">Opened</th>
              <th className="px-3 py-2 text-right font-medium">Real</th>
              <th className="px-3 py-2 text-right font-medium">Median open</th>
              <th className="px-3 py-2 text-right font-medium">Wakes</th>
              <th className="px-3 py-2 text-right font-medium">Tokens</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.check} className="border-border/60 border-b">
                <td className="px-3 py-2">{r.check}</td>
                <td className="px-3 py-2 text-right">{r.opened}</td>
                <td className="px-3 py-2 text-right">{r.real}</td>
                <td className="px-3 py-2 text-right">
                  {r.medianOpenMs === null ? "—" : duration(r.medianOpenMs)}
                </td>
                <td className="px-3 py-2 text-right">{r.wakes}</td>
                <td className="px-3 py-2 text-right">{tokens(r.tokens)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right">{sum((r) => r.opened)}</td>
              <td className="px-3 py-2 text-right">{sum((r) => r.real)}</td>
              <td className="px-3 py-2 text-right">—</td>
              <td className="px-3 py-2 text-right">{sum((r) => r.wakes)}</td>
              <td className="px-3 py-2 text-right">
                {tokens(sum((r) => r.tokens))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Notes() {
  const { data } = useHealthNotes();
  const add = useAddNote();
  const del = useDeleteNote();
  const [area, setArea] = useState<Area>("scheduler");
  const [line, setLine] = useState("");
  if (!data) return null;
  return (
    <div className="space-y-5">
      <p className="text-muted-foreground text-sm">
        What normal looks like. A watcher reads these before it judges, and adds
        a line when it learns something is normal.
      </p>
      {AREAS.map((a) => (
        <div key={a} className="space-y-2">
          <h3 className="label-mono text-muted-foreground">{AREA_LABELS[a]}</h3>
          <ul className="border-border/60 overflow-hidden rounded-xl border">
            {data.seeds[a].map((s) => (
              <li
                key={s}
                className="border-border/60 border-b px-3 py-2 text-sm last:border-b-0"
              >
                {s}
              </li>
            ))}
            {data.notes
              .filter((n) => n.area === a)
              .map((n) => (
                <li
                  key={n.id}
                  className="border-border/60 flex items-start gap-2 border-b px-3 py-2 text-sm last:border-b-0"
                >
                  <span className="min-w-0 flex-1 break-words">{n.line}</span>
                  <Chip>{n.source === "saad" ? "yours" : "learned"}</Chip>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground -my-2 min-h-11 px-2 text-xs"
                    onClick={() => del.mutate(n.id)}
                    aria-label={`Delete note: ${n.line}`}
                  >
                    Delete
                  </button>
                </li>
              ))}
          </ul>
        </div>
      ))}
      <form
        className="flex flex-col gap-2 md:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!line.trim()) return;
          add.mutate({ area, line }, { onSuccess: () => setLine("") });
        }}
      >
        <select
          value={area}
          onChange={(e) => setArea(e.target.value as Area)}
          aria-label="Area"
          className="border-border/60 bg-card/60 h-11 rounded-lg border px-2 text-sm md:h-9"
        >
          {AREAS.map((a) => (
            <option key={a} value={a}>
              {AREA_LABELS[a]}
            </option>
          ))}
        </select>
        <Input
          value={line}
          onChange={(e) => setLine(e.target.value)}
          placeholder="Add a line about what's normal"
          maxLength={200}
          aria-label="New note"
          className="h-11 flex-1 md:h-9"
        />
        <Button type="submit" className="h-11 md:h-9" disabled={!line.trim()}>
          Add
        </Button>
      </form>
    </div>
  );
}

function Thresholds() {
  const { data } = useHealthConfig();
  const save = useSaveConfig();
  const [draft, setDraft] = useState<Record<string, string>>({});
  if (!data) return null;
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        When a check trips. Clear a box to go back to the default.
      </p>
      <ul className="border-border/60 overflow-hidden rounded-xl border">
        {Object.keys(data.defaults).map((k) => {
          const value = draft[k] ?? String(data.config[k]);
          return (
            <li
              key={k}
              className="border-border/60 flex items-center gap-3 border-b px-3 py-2 last:border-b-0"
            >
              <label htmlFor={`health-${k}`} className="min-w-0 flex-1 text-sm">
                {data.labels[k]}
                <span className="text-muted-foreground block text-xs">
                  default {data.defaults[k]}
                </span>
              </label>
              <Input
                id={`health-${k}`}
                inputMode="decimal"
                value={value}
                onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                onBlur={() => {
                  if (draft[k] === undefined) return;
                  const raw = draft[k].trim();
                  save.mutate(
                    { [k]: raw === "" ? null : Number(raw) },
                    {
                      onSettled: () => setDraft(({ [k]: _, ...rest }) => rest),
                    }
                  );
                }}
                className="h-11 w-24 text-right tabular-nums md:h-9"
              />
            </li>
          );
        })}
      </ul>
      {save.error && (
        <p role="alert" className="text-destructive text-sm">
          {save.error.message}
        </p>
      )}
    </div>
  );
}

export function HealthPanel() {
  const { data, error } = useHealthQuery();
  const dismiss = useDismissAnomaly();
  const [tab, setTab] = useState<Tab>("open");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {data && data.open.length > 0 && (
          <Chip tone="amber">{data.open.length} open</Chip>
        )}
        {data && data.needsYou > 0 && (
          <Chip tone="red">{data.needsYou} needs you</Chip>
        )}
        <div
          role="tablist"
          aria-label="Health"
          className="flex flex-wrap gap-1 md:ml-auto"
        >
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                "min-h-11 rounded-md px-3 text-sm md:min-h-8",
                tab === t
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error.message}
        </p>
      )}
      {tab === "open" && data && (
        <>
          <List
            items={data.open}
            now={data.now}
            empty="Nothing is wrong. The checks run every minute and cost nothing until one trips."
            onDismiss={(id) => dismiss.mutate(id)}
          />
          <Summary rows={data.summary} />
        </>
      )}
      {tab === "history" && data && (
        <List
          items={data.history}
          now={data.now}
          empty="Nothing has closed in the last 7 days."
        />
      )}
      {tab === "notes" && <Notes />}
      {tab === "thresholds" && <Thresholds />}
    </div>
  );
}
