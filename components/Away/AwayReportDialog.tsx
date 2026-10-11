"use client";

import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type {
  AwayReport,
  DeployState,
  WorkspaceReport,
} from "@/lib/away/report";
import { useDismissAwayReport } from "@/data/away";
import { settingsUiActions } from "@/stores/settingsUi";
import { cn } from "@/lib/utils";
import { awayRange } from "./time";

const DEPLOY: Record<DeployState, { label: string; tone: string }> = {
  deployed: {
    label: "Deployed",
    tone: "text-emerald-700 dark:text-emerald-400",
  },
  failed: { label: "Deploy failed", tone: "text-destructive" },
  pending: {
    label: "Deploy not confirmed",
    tone: "text-amber-700 dark:text-amber-300",
  },
  unchecked: { label: "No deploy check", tone: "text-muted-foreground" },
};

function PrLink({ pr, url }: { pr: number | null; url: string | null }) {
  if (!pr) return null;
  if (!url || !url.startsWith("https://"))
    return <span className="text-muted-foreground">#{pr}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="text-primary inline-flex min-h-11 items-center gap-1 underline-offset-2 hover:underline md:min-h-0"
    >
      #{pr}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function Row({ children }: { children: ReactNode }) {
  return (
    <li className="bg-foreground/[0.03] rounded-xl px-3 py-2 text-sm break-words">
      {children}
    </li>
  );
}

function Section<T>({
  title,
  report,
  pick,
  render,
  empty,
}: {
  title: string;
  report: AwayReport;
  pick: (w: WorkspaceReport) => T[];
  render: (item: T) => ReactNode;
  empty: string;
}) {
  const groups = report.workspaces.filter((w) => pick(w).length);
  const many = report.workspaces.length > 1;
  return (
    <section className="space-y-1.5">
      <h3 className="label-mono text-muted-foreground">{title}</h3>
      {groups.length ? (
        <ul className="space-y-1.5">
          {groups.flatMap((w) =>
            pick(w).map((item, i) => (
              <Row key={`${w.id}-${i}`}>
                {many && (
                  <span className="text-muted-foreground mr-1.5 text-xs">
                    {w.name}
                  </span>
                )}
                {render(item)}
              </Row>
            ))
          )}
        </ul>
      ) : (
        <p className="text-muted-foreground px-1 text-sm">{empty}</p>
      )}
    </section>
  );
}

export function AwayReportDialog({ report }: { report: AwayReport }) {
  const dismiss = useDismissAwayReport();
  const close = () => dismiss.mutate(report.awayId);
  const t = report.totals;
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>While you were away</DialogTitle>
          <DialogDescription>
            {awayRange(report.startedAt, report.endedAt)}
            {report.endedBy === "expired" ? ", when Away ran out" : ""}.{" "}
            {t.merged} merged, {t.inFlight} in flight, {t.failed} failed or
            escalated, {t.waiting} waiting on you.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Section
            title="Waiting on you"
            report={report}
            pick={(w) => w.waiting}
            empty="None. Nothing is waiting on you."
            render={(a) => (
              <>
                {a.hardLine && (
                  <span className="text-destructive mr-1.5 text-xs font-medium">
                    Hard line
                  </span>
                )}
                <span className="text-muted-foreground mr-1">{a.kind}:</span>
                {a.title}
              </>
            )}
          />
          <Section
            title="Merged"
            report={report}
            pick={(w) => w.merged}
            empty="None."
            render={(m) => (
              <>
                <span className="font-medium">{m.task}</span>{" "}
                <PrLink pr={m.pr} url={m.url} />
                <span className={cn("block text-xs", DEPLOY[m.deploy].tone)}>
                  {DEPLOY[m.deploy].label}
                  {m.deployDetail ? `: ${m.deployDetail}` : ""}
                </span>
              </>
            )}
          />
          <Section
            title="Still in flight"
            report={report}
            pick={(w) => w.inFlight}
            empty="None."
            render={(f) => (
              <>
                <span className="font-medium">{f.task}</span>{" "}
                <PrLink pr={f.pr} url={f.url} />
                <span className="text-muted-foreground block text-xs">
                  {f.why}
                </span>
              </>
            )}
          />
          <Section
            title="Failed or escalated"
            report={report}
            pick={(w) => w.failed}
            empty="None."
            render={(f) => f.what}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="secondary"
            className="h-11 md:h-9"
            onClick={() => {
              close();
              settingsUiActions.open("audits");
            }}
          >
            Kept in Audits
          </Button>
          <Button className="h-11 md:h-9" onClick={close}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
