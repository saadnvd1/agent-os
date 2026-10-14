"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingToggle } from "@/components/Settings/SettingToggle";
import { formatTokens } from "@/lib/chat/context";
import {
  useExperimentDetailQuery,
  useExperimentsQuery,
  useSetExperiment,
  type ExperimentView,
} from "@/data/experiments";

const usd = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number | null) =>
  n === null ? "-" : `${Math.round(n * 100)}%`;

const WINDOWS = [
  ["today", "Today"],
  ["d7", "7 days"],
  ["d30", "30 days"],
] as const;

function Usage({ e }: { e: ExperimentView }) {
  return (
    <table className="w-full text-xs tabular-nums">
      <thead className="text-muted-foreground">
        <tr>
          <th className="py-1 text-left font-normal" />
          <th className="py-1 text-right font-normal">Calls</th>
          <th className="py-1 text-right font-normal">Tokens</th>
          <th className="py-1 text-right font-normal">Cost</th>
          {e.suggests && (
            <th className="py-1 text-right font-normal">Accepted</th>
          )}
        </tr>
      </thead>
      <tbody>
        {WINDOWS.map(([key, label]) => {
          const w = e.usage[key];
          return (
            <tr key={key} className="border-border border-t">
              <td className="py-1">{label}</td>
              <td className="py-1 text-right">{w.calls}</td>
              <td className="py-1 text-right">{formatTokens(w.tokens)}</td>
              <td className="py-1 text-right">{usd(w.costUsd)}</td>
              {e.suggests && (
                <td className="py-1 text-right">
                  {pct(w.acceptRate)}
                  {w.accepted + w.dismissed > 0 &&
                    ` (${w.accepted}/${w.accepted + w.dismissed})`}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Detail({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, isPending, isError, error } = useExperimentDetailQuery(id);
  return (
    <div className="space-y-4">
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="min-h-11 md:min-h-0"
      >
        <ArrowLeft className="h-4 w-4" /> Experiments
      </Button>
      {isPending && (
        <div className="bg-muted/40 h-24 animate-pulse rounded-lg" />
      )}
      {isError && <p className="text-destructive text-sm">{error.message}</p>}
      {data && (
        <>
          <div>
            <h3 className="text-sm font-medium">{data.name}</h3>
            <p className="text-muted-foreground text-xs">{data.description}</p>
          </div>
          <Usage e={data} />
          <Breakdowns title="By trigger" rows={data.detail.byTrigger} />
          <Breakdowns title="By model" rows={data.detail.byModel} />
          <section>
            <h4 className="text-muted-foreground mb-1 text-xs">Last 30 days</h4>
            <table className="w-full text-xs tabular-nums">
              <tbody>
                {data.detail.days
                  .filter((d) => d.calls || d.accepted || d.dismissed)
                  .reverse()
                  .map((d) => (
                    <tr key={d.day} className="border-border border-t">
                      <td className="py-1">{d.day}</td>
                      <td className="py-1 text-right">{d.calls} calls</td>
                      <td className="py-1 text-right">
                        {formatTokens(d.tokens)}
                      </td>
                      <td className="py-1 text-right">{usd(d.costUsd)}</td>
                      <td className="py-1 text-right">
                        {d.accepted}/{d.accepted + d.dismissed}
                      </td>
                    </tr>
                  ))}
                <tr className="border-border border-t font-medium">
                  <td className="py-1">Total</td>
                  <td className="py-1 text-right">
                    {data.detail.days.reduce((t, d) => t + d.calls, 0)} calls
                  </td>
                  <td className="py-1 text-right">
                    {formatTokens(
                      data.detail.days.reduce((t, d) => t + d.tokens, 0)
                    )}
                  </td>
                  <td className="py-1 text-right">
                    {usd(data.detail.days.reduce((t, d) => t + d.costUsd, 0))}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </section>
          {data.detail.recent.length > 0 && (
            <section>
              <h4 className="text-muted-foreground mb-1 text-xs">Recent</h4>
              <ul className="space-y-1 text-xs">
                {data.detail.recent.map((r, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">
                      {new Date(r.at).toLocaleString()} · {r.event} ·{" "}
                      {r.trigger}
                      {r.detail ? ` · ${r.detail}` : ""}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {r.tokens ? formatTokens(r.tokens) : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Breakdowns({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; calls: number; tokens: number; costUsd: number }[];
}) {
  if (!rows.length) return null;
  return (
    <section>
      <h4 className="text-muted-foreground mb-1 text-xs">{title}</h4>
      <table className="w-full text-xs tabular-nums">
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-border border-t">
              <td className="py-1">{r.key}</td>
              <td className="py-1 text-right">{r.calls} calls</td>
              <td className="py-1 text-right">{formatTokens(r.tokens)}</td>
              <td className="py-1 text-right">{usd(r.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function ExperimentsSection() {
  const { data, isPending, isError, error } = useExperimentsQuery();
  const set = useSetExperiment();
  const [open, setOpen] = useState<string | null>(null);

  if (open) return <Detail id={open} onBack={() => setOpen(null)} />;
  if (isPending)
    return <div className="bg-muted/40 h-16 animate-pulse rounded-lg" />;
  if (isError)
    return <p className="text-destructive text-sm">{error.message}</p>;

  return (
    <div className="space-y-5">
      <p className="text-muted-foreground text-sm">
        Features still being tried. Each is off until you turn it on, does no
        work while off, and shows what it costs here.
      </p>
      {data.experiments.map((e) => (
        <div key={e.id} className="space-y-2">
          <SettingToggle
            title={`${e.name} · ${e.status === "beta" ? "Beta" : "Experimental"}`}
            detail={e.description}
            checked={e.on}
            locked={data.locked}
            onChange={(on) =>
              set.mutate(
                { id: e.id, on },
                { onError: (err) => toast.error(err.message) }
              )
            }
          />
          <div className="px-3">
            <Usage e={e} />
            <Button
              variant="link"
              size="sm"
              className="min-h-11 px-0 md:min-h-0"
              onClick={() => setOpen(e.id)}
            >
              Details
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
