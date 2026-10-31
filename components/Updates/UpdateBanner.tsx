"use client";

import { useEffect, useState } from "react";
import { ArrowUpCircle, ChevronDown, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUpdates } from "@/data/updates";
import { useDismissedUpdate } from "@/hooks/useDismissedUpdate";
import { useReloadWhenUpdated } from "@/hooks/useReloadWhenUpdated";
import {
  bannerState,
  type BannerState,
  type UpdateView,
} from "@/lib/updates/banner";
import { cn } from "@/lib/utils";
import { WhatsNewHost } from "@/components/WhatsNew";
import { whatsNewActions } from "@/stores/whatsNew";
import { UpdateActions } from "./UpdateActions";

const STEPS = [
  "pulling",
  "installing",
  "building",
  "restarting",
  "verifying",
] as const;
const LABEL: Record<(typeof STEPS)[number], string> = {
  pulling: "Pulling the new version",
  installing: "Installing dependencies",
  building: "Building",
  restarting: "Restarting",
  verifying: "Checking the new version",
};
const SLOW_MS = 10 * 60_000;

function useSince(startedAt: number | undefined, on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [on]);
  return startedAt ? now - startedAt : 0;
}

function Log({ lines }: { lines: string[] }) {
  const [open, setOpen] = useState(false);
  if (!lines.length) return null;
  return (
    <>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground min-h-11 text-xs underline md:min-h-0"
        onClick={() => setOpen(!open)}
      >
        {open ? "Hide log" : "Show log"}
      </button>
      {open && (
        <pre className="bg-background/60 mt-1 max-h-48 w-full overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap">
          {lines.join("\n")}
        </pre>
      )}
    </>
  );
}

/** The bar itself; what to show and what the buttons do come in as props. */
export function UpdateBannerView({
  state,
  view,
  onDismiss,
}: {
  state: Exclude<BannerState, "hidden">;
  view: UpdateView;
  onDismiss: () => void;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const run = view.run;
  const elapsed = useSince(run?.startedAt, state === "running");
  const latest = view.latest;
  const failed = state === "failed";

  let text: React.ReactNode;
  if (state === "available") text = <>AgentOS {latest?.version} is available</>;
  else if (state === "pending")
    text = <>AgentOS will update when nothing is working</>;
  else if (state === "built")
    text = <>Built {run?.toVersion}. Restart AgentOS to finish updating.</>;
  else if (failed) text = <>The update didn&apos;t finish. {run?.error}</>;
  else if (state === "updated")
    text = <>AgentOS updated itself to {run?.toVersion}</>;
  else if (state === "rolled_back")
    text = (
      <>
        An update to {run?.toVersion} didn&apos;t start cleanly, so AgentOS went
        back to {run?.fromVersion}. It won&apos;t try that version again.
      </>
    );
  else {
    const step = Math.max(
      0,
      STEPS.indexOf(run!.phase as (typeof STEPS)[number])
    );
    text =
      run?.phase === "rolling_back" ? (
        <>The new version didn&apos;t start cleanly; going back…</>
      ) : elapsed > SLOW_MS ? (
        <>Taking longer than expected. Check the update log, then reload.</>
      ) : (
        <>
          {LABEL[STEPS[step]]}… step {step + 1} of {STEPS.length}
        </>
      );
  }

  const extra = (
    <>
      {state === "available" && !view.canUpdate.ok && view.canUpdate.reason && (
        <p className="text-muted-foreground text-xs">{view.canUpdate.reason}</p>
      )}
      {(failed || state === "rolled_back") && <Log lines={run?.log ?? []} />}
      {notesOpen && latest && (
        <ul className="text-muted-foreground list-disc space-y-0.5 pl-4 text-xs">
          {latest.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </>
  );

  return (
    <div
      role={failed ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 border-b px-3 py-2 text-sm",
        failed ? "bg-destructive/10 text-foreground" : "bg-muted/60"
      )}
    >
      <span className="flex h-6 shrink-0 items-center md:h-8">
        {state === "running" ? (
          <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
        ) : (
          <ArrowUpCircle
            className={cn(
              "h-4 w-4",
              failed ? "text-destructive" : "text-primary"
            )}
          />
        )}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 md:min-h-8">
          <p className="min-w-0 flex-1 basis-40">{text}</p>
          {state === "available" && latest && latest.notes.length > 0 && (
            <button
              type="button"
              aria-expanded={notesOpen}
              className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center gap-1 text-xs md:min-h-0"
              onClick={() => setNotesOpen(!notesOpen)}
            >
              Commit list
              <ChevronDown
                className={cn(
                  "h-3 w-3 transition-transform",
                  notesOpen && "rotate-180"
                )}
              />
            </button>
          )}
          {(state === "available" || state === "updated") && (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center text-xs underline md:min-h-0"
              onClick={() => whatsNewActions.open(true)}
            >
              See what&apos;s new
            </button>
          )}
          {state === "available" && latest?.url && (
            <a
              href={latest.url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center text-xs underline md:min-h-0"
            >
              Release notes
            </a>
          )}
          {(state === "available" || state === "pending") && (
            <UpdateActions view={view} />
          )}
          {state === "running" && elapsed > SLOW_MS && (
            <Button size="sm" onClick={() => window.location.reload()}>
              Reload
            </Button>
          )}
        </div>
        {extra}
      </div>
      {state !== "running" && state !== "pending" && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={
            state === "available" ? "Dismiss until the next version" : "Dismiss"
          }
          className="-my-1 -mr-1 h-11 w-11 shrink-0 md:h-8 md:w-8"
          onClick={onDismiss}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

// Held apart: the page re-renders on every status push.
export function UpdateBanner() {
  const { data: view } = useUpdates();
  const dismissed = useDismissedUpdate();
  useReloadWhenUpdated(view);
  const state = bannerState({
    view,
    dismissedVersion: dismissed.version,
    dismissedRun: dismissed.run,
  });
  if (state === "hidden" || !view) return <WhatsNewHost />;
  return (
    <>
      <WhatsNewHost />
      <UpdateBannerView
        state={state}
        view={view}
        onDismiss={() =>
          state === "available" && view.latest
            ? dismissed.dismissVersion(view.latest.version)
            : view.run
              ? dismissed.dismissRun(view.run.id)
              : undefined
        }
      />
    </>
  );
}
