"use client";

import { useState, useSyncExternalStore } from "react";
import { Fingerprint, KeyRound, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NO_PASSKEYS_HERE, passkeysHere } from "@/data/presence";
import {
  useAddPasskey,
  useEnrollCode,
  usePasskeysQuery,
  useRevokePasskey,
} from "@/data/presence/passkeys";
import { lastSeen } from "./DeviceRow";

const when = (s: string) =>
  new Date(`${s.replace(" ", "T")}Z`).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const fail = (e: Error) => toast.error(e.message);

// Passkeys prove it's you approving an ask or resuming an orchestrator.
// Each belongs to the host name it was made on.
export function PasskeysSection({ open }: { open: boolean }) {
  const { data } = usePasskeysQuery(open);
  const add = useAddPasskey();
  const enroll = useEnrollCode();
  const revoke = useRevokePasskey();
  const [code, setCode] = useState("");
  const here = useSyncExternalStore(
    () => () => {},
    passkeysHere,
    () => true
  );
  const keys = data?.passkeys ?? [];
  const mineHere = keys.some((k) => k.rp_id === data?.host);
  const btn = "h-11 sm:h-9";

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs">
        Approving a merge, a brake or anything on a hard line, and resuming an
        orchestrator, need Touch ID or Face ID. A new passkey shows up as an ask
        to confirm.
      </p>
      {keys.map((k) => (
        <div
          key={k.id}
          className="bg-muted/40 flex items-center gap-3 rounded-lg px-3 py-2.5"
        >
          <KeyRound className="text-muted-foreground h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{k.name}</p>
            <p className="text-muted-foreground truncate text-xs">
              {k.rp_id} · added {when(k.created_at)}
              {k.registered_from ? ` from ${k.registered_from}` : ""} · used{" "}
              {lastSeen(k.last_used_at)}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-11 w-11 sm:h-8 sm:w-8"
            disabled={revoke.isPending}
            aria-label={`Revoke ${k.name}`}
            onClick={() =>
              window.confirm(`Revoke the passkey "${k.name}"?`) &&
              revoke.mutate(k.id, { onError: fail })
            }
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      {!here ? (
        <p className="text-muted-foreground text-xs">{NO_PASSKEYS_HERE}</p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          {!mineHere && keys.length > 0 && (
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Code from another device"
              className="h-11 sm:h-9"
            />
          )}
          {!mineHere && (
            <Button
              className={btn}
              disabled={add.isPending || (keys.length > 0 && !code.trim())}
              onClick={() =>
                add.mutate(code.trim() || undefined, {
                  onError: fail,
                  onSuccess: () => setCode(""),
                })
              }
            >
              <Fingerprint className="h-4 w-4" />
              Add a passkey here
            </Button>
          )}
          {mineHere && (
            <Button
              variant="secondary"
              className={btn}
              disabled={enroll.isPending}
              onClick={() => enroll.mutate(undefined, { onError: fail })}
            >
              Code for another device
            </Button>
          )}
        </div>
      )}
      {enroll.data && (
        <p className="text-sm">
          Enter <span className="font-mono font-medium">{enroll.data}</span> on
          the other device within 10 minutes.
        </p>
      )}
    </div>
  );
}
