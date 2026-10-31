"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { TipHost } from "@/components/Tips";
import { WhatsNewHost } from "@/components/WhatsNew";
import { whatsNewActions } from "@/stores/whatsNew";
import { settingsUiActions } from "@/stores/settingsUi";
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

export const UPDATE_TOAST_ID = "agentos-update";
const UPDATED_AUTOCLOSE_MS = 6000;
const DESKTOP_QUERY = "(min-width: 768px)";

/** The toast's content; what to show and what the buttons do come in as props. */
export function UpdateToastView({
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
  const link =
    "text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center text-xs underline md:min-h-0";

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

  return (
    <div
      role={failed ? "alert" : "status"}
      className={cn(
        "bg-card text-foreground pointer-events-auto flex w-[356px] max-w-[calc(100vw-2rem)] items-start gap-2 rounded-lg border p-3 text-sm shadow-lg",
        failed && "border-destructive/50"
      )}
    >
      <span className="flex h-6 shrink-0 items-center">
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
        <p className="min-h-6 leading-6">{text}</p>
        {state === "available" &&
          !view.canUpdate.ok &&
          view.canUpdate.reason && (
            <p className="text-muted-foreground text-xs">
              {view.canUpdate.reason}
            </p>
          )}
        {notesOpen && latest && (
          <ul className="text-muted-foreground list-disc space-y-0.5 pl-4 text-xs">
            {latest.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {(state === "available" || state === "pending") && (
            <UpdateActions view={view} />
          )}
          {state === "running" && elapsed > SLOW_MS && (
            <Button size="sm" onClick={() => window.location.reload()}>
              Reload
            </Button>
          )}
          {(failed || state === "rolled_back") && (
            <button
              type="button"
              className={link}
              onClick={() => settingsUiActions.open("updates")}
            >
              View log
            </button>
          )}
          {state === "available" && latest && latest.notes.length > 0 && (
            <button
              type="button"
              aria-expanded={notesOpen}
              className={cn(link, "gap-1 no-underline")}
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
              className={link}
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
              className={link}
            >
              Release notes
            </a>
          )}
        </div>
      </div>
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
    </div>
  );
}

function useIsDesktop() {
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const on = () => setDesktop(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desktop;
}

/**
 * One sonner toast with a fixed id, updated in place as the update moves on.
 * Bottom-right on desktop; top-center on phones, where the bottom is the
 * composer. Held apart: the page re-renders on every status push.
 */
export function UpdateToast() {
  const { data: view } = useUpdates();
  const dismissed = useDismissedUpdate();
  const queryClient = useQueryClient();
  const desktop = useIsDesktop();
  // Closing a running or pending toast hides it for that run only; the
  // result (updated, failed) still shows afterwards.
  const [closed, setClosed] = useState<string | null>(null);
  useReloadWhenUpdated(view);
  const computed = bannerState({
    view,
    dismissedVersion: dismissed.version,
    dismissedRun: dismissed.run,
  });
  const key =
    computed === "running"
      ? `running:${view?.run?.id}`
      : computed === "pending"
        ? `pending:${view?.pending?.requestedAt}`
        : null;
  const state = key && key === closed ? "hidden" : computed;

  const { dismissVersion, dismissRun } = dismissed;
  useEffect(() => {
    if (state === "hidden" || !view) {
      toast.dismiss(UPDATE_TOAST_ID);
      return;
    }
    const onDismiss = () => {
      toast.dismiss(UPDATE_TOAST_ID);
      if (key) setClosed(key);
      else if (state === "available" && view.latest)
        dismissVersion(view.latest.version);
      else if (view.run) dismissRun(view.run.id);
    };
    const el: ReactNode = (
      <QueryClientProvider client={queryClient}>
        <UpdateToastView state={state} view={view} onDismiss={onDismiss} />
      </QueryClientProvider>
    );
    toast.custom(() => el, {
      id: UPDATE_TOAST_ID,
      position: desktop ? "bottom-right" : "top-center",
      duration: state === "updated" ? UPDATED_AUTOCLOSE_MS : Infinity,
      onAutoClose: onDismiss,
    });
  }, [state, view, key, desktop, queryClient, dismissVersion, dismissRun]);
  useEffect(() => () => void toast.dismiss(UPDATE_TOAST_ID), []);

  return (
    <>
      <WhatsNewHost />
      <TipHost />
    </>
  );
}
