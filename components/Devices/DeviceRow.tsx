"use client";

import { Laptop, Smartphone, Tablet, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ListedDevice } from "@/lib/security/devices";
import { CATEGORIES } from "@/lib/notify/copy";
import {
  useRevokeDevice,
  useSendTestPush,
  useSetCanApprove,
} from "@/data/devices";
import { Switch } from "@/components/ui/switch";

// SQLite's datetime('now') is UTC without a zone.
const parseUtc = (s: string) => new Date(`${s.replace(" ", "T")}Z`);

export function lastSeen(s: string | null, now = Date.now()): string {
  if (!s) return "never used";
  const mins = Math.round((now - parseUtc(s).getTime()) / 60_000);
  if (mins < 2) return "active now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

function DeviceIcon({ ua }: { ua: string | null }) {
  const className = "text-muted-foreground h-4 w-4 shrink-0";
  if (/iPad|Tablet/i.test(ua ?? "")) return <Tablet className={className} />;
  if (/iPhone|Android|Mobile/i.test(ua ?? ""))
    return <Smartphone className={className} />;
  return <Laptop className={className} />;
}

export function DeviceRow({
  device,
  isCurrent,
  canManage,
}: {
  device: ListedDevice;
  isCurrent: boolean;
  // Only this machine or the tailnet may let a device approve asks.
  canManage: boolean;
}) {
  const revoke = useRevokeDevice();
  const setCanApprove = useSetCanApprove();
  const sendTest = useSendTestPush();
  const tested = sendTest.data?.results[0];
  const testNote = sendTest.isError
    ? sendTest.error.message
    : tested
      ? tested.status === "sent"
        ? "Test sent"
        : `Test failed: ${tested.error}`
      : null;

  const onRevoke = () => {
    if (
      isCurrent &&
      !window.confirm("This is the device you're using. Sign it out?")
    )
      return;
    revoke.mutate(device.id);
  };

  return (
    <div className="bg-muted/40 flex items-center gap-3 rounded-lg px-3 py-2.5">
      <DeviceIcon ua={device.user_agent} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-sm font-medium">
          {device.name}
          {isCurrent && (
            <span className="bg-primary/15 text-primary rounded-full px-1.5 py-0.5 text-[10px]">
              this device
            </span>
          )}
        </p>
        <p className="text-muted-foreground truncate text-xs">
          {lastSeen(device.last_seen_at)}
          {device.last_address ? ` · ${device.last_address}` : ""}
        </p>
        {device.push.enabled && (
          <p className="text-muted-foreground truncate text-xs">
            Push on ·{" "}
            {device.push.categories
              .map((c) => CATEGORIES[c].label)
              .join(", ") || "nothing selected"}
          </p>
        )}
        {device.push.lastError && (
          <p
            className="text-destructive truncate text-xs"
            title={device.push.lastError}
          >
            Push error: {device.push.lastError}
          </p>
        )}
        {testNote && (
          <p
            className={`truncate text-xs ${tested?.status === "sent" ? "text-muted-foreground" : "text-destructive"}`}
            role="status"
          >
            {testNote}
          </p>
        )}
      </div>
      {device.push.enabled && (
        <Button
          variant="outline"
          size="sm"
          className="h-11 shrink-0 sm:h-8"
          onClick={() => sendTest.mutate(device.id)}
          disabled={sendTest.isPending}
        >
          {sendTest.isPending ? "Sending…" : "Send test"}
        </Button>
      )}
      <label className="text-muted-foreground flex min-h-11 shrink-0 items-center gap-2 text-xs sm:min-h-8">
        Can approve
        <Switch
          checked={!!device.can_approve}
          disabled={!canManage || setCanApprove.isPending}
          onCheckedChange={(on) =>
            setCanApprove.mutate({ id: device.id, canApprove: on })
          }
        />
      </label>
      <Button
        variant="ghost"
        size="icon-sm"
        className="h-11 w-11 sm:h-8 sm:w-8"
        onClick={onRevoke}
        disabled={revoke.isPending}
        aria-label={`Remove ${device.name}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
