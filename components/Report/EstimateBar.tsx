import type { Estimate } from "@/lib/reports/types";
import { estimateLabel, estimatePercent } from "@/lib/reports/types";

// The percentage never shows without its label: it is an estimate, and the
// label says how it was counted.
export function EstimateBar({ estimate }: { estimate: Estimate }) {
  const pct = estimatePercent(estimate);
  const how =
    estimate.basis === "acceptance"
      ? "Acceptance items the plan listed, counted when a passing test, check or review backs them."
      : "The plan has no acceptance items, so this counts delivery stages: plan, push, pull request, CI, review, merge.";
  return (
    <div className="space-y-2" title={how}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground text-xs">
          {estimateLabel(estimate)}
        </span>
        <span className="text-sm font-semibold tabular-nums">{pct}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={estimate.total}
        aria-valuenow={estimate.done}
        aria-label={estimateLabel(estimate)}
        className="bg-muted h-2 overflow-hidden rounded-full"
      >
        <div
          className="bg-primary h-full rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
      <details className="text-xs">
        <summary className="text-muted-foreground flex min-h-11 cursor-pointer items-center">
          How this is counted
        </summary>
        <p className="text-muted-foreground pb-2">{how}</p>
        <ul className="space-y-1 pb-1">
          {estimate.items.map((i) => (
            <li key={i.label} className="flex gap-2">
              <span aria-hidden>{i.verified ? "✓" : "○"}</span>
              <span className={i.verified ? "" : "text-muted-foreground"}>
                {i.label}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
