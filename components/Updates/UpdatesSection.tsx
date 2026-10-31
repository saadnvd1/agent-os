"use client";

import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingToggle } from "@/components/Settings/SettingToggle";
import { useSetTipsOff, useTips } from "@/data/tips";
import {
  useCheckForUpdates,
  useUpdateBannerSetting,
  useUpdates,
} from "@/data/updates";
import { isActivePhase } from "@/lib/updates/banner";
import { UpdateActions } from "./UpdateActions";

function ago(at: number | null): string {
  if (!at) return "not yet";
  const min = Math.floor((Date.now() - at) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const h = Math.floor(min / 60);
  return h < 48
    ? `${h} hour${h === 1 ? "" : "s"} ago`
    : `${Math.floor(h / 24)} days ago`;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{value}</dd>
    </div>
  );
}

// Settings > Updates: what's installed, what's out, and the switch for the banner.
export function UpdatesSection() {
  const { data: view, isLoading, error } = useUpdates();
  const check = useCheckForUpdates();
  const banner = useUpdateBannerSetting();

  if (isLoading || !view)
    return (
      <p className="text-muted-foreground text-sm">
        {error ? "Couldn't load update status." : "Loading…"}
      </p>
    );

  const running = isActivePhase(view.run?.phase);
  const onCheck = () =>
    check.mutate(undefined, {
      onError: (e) => {
        // Asked again inside a minute: the answer on screen is fresh.
        if ((e as { status?: number }).status !== 429) toast.error(e.message);
      },
    });

  let summary = "AgentOS is up to date.";
  if (view.status === "diverged")
    summary =
      "This checkout has commits the remote doesn't, so it can't update itself.";
  else if (view.status === "unknown")
    summary = view.checkError ?? "Updates haven't been checked yet.";
  else if (view.available)
    summary = `${view.latest?.version} is available (${view.behind} newer change${view.behind === 1 ? "" : "s"}).`;

  return (
    <div className="space-y-5">
      <dl className="divide-border divide-y">
        <Row
          label="Installed"
          value={
            view.current ? (
              <>
                {view.current.version}{" "}
                <span className="text-muted-foreground font-mono text-xs">
                  {view.current.sha.slice(0, 7)}
                </span>
              </>
            ) : (
              "Unknown"
            )
          }
        />
        <Row label="Latest" value={view.latest?.version ?? "Unknown"} />
        <Row label="Last checked" value={ago(view.checkedAt)} />
      </dl>

      <p className="text-sm" role="status">
        {summary}
      </p>
      {view.checkError && view.status === "ok" && (
        <p className="text-muted-foreground text-xs">
          The last check failed: {view.checkError}
        </p>
      )}
      {view.run?.phase === "failed" && (
        <p className="text-destructive text-sm" role="alert">
          The last update failed. {view.run.error}
        </p>
      )}
      {running && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Updating (
          {view.run?.phase})…
        </p>
      )}
      {view.available && !view.canUpdate.ok && view.canUpdate.reason && (
        <p className="text-muted-foreground text-xs">{view.canUpdate.reason}</p>
      )}
      {view.pending && (
        <p className="text-muted-foreground text-sm">
          Will update when nothing is working.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 md:min-h-0"
          disabled={check.isPending || running}
          onClick={onCheck}
        >
          {check.isPending ? "Checking…" : "Check for updates"}
        </Button>
        {view.available && !running && <UpdateActions view={view} />}
        {view.available && view.latest?.url && (
          <a
            href={view.latest.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary text-sm underline"
          >
            Release notes
          </a>
        )}
      </div>

      <SettingToggle
        title="Show update banner"
        detail="Tell everyone using this AgentOS when a newer version is out. Nothing updates unless someone chooses to."
        checked={view.bannerEnabled}
        locked={view.bannerLocked}
        onChange={(on) =>
          banner.mutate(on, { onError: (e) => toast.error(e.message) })
        }
      />
      <TipsToggle />
    </div>
  );
}

function TipsToggle() {
  const { data } = useTips();
  const setOff = useSetTipsOff();
  return (
    <SettingToggle
      title="Show Tip of the Day"
      detail="A short tip about something AgentOS can do, behind the lightbulb in the sidebar. It never opens on its own."
      checked={!!data && !data.off}
      onChange={(on) =>
        setOff.mutate(!on, { onError: (e) => toast.error(e.message) })
      }
    />
  );
}
