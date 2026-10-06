"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deviceKeys, usePairingStatus, useStartPairing } from "@/data/devices";

const LABEL = {
  connect: "Connect",
  tailscale: "Tailscale",
  lan: "Wi-Fi",
} as const;
const CHOICE = {
  connect: "Anywhere",
  tailscale: "Phone on Tailscale",
  lan: "Phone on this Wi-Fi",
} as const;

export function AddDevicePanel({ onDone }: { onDone: () => void }) {
  const start = useStartPairing();
  const offer = start.data;
  const { data: status } = usePairingStatus(offer?.code ?? null);
  const { mutate } = start;
  const queryClient = useQueryClient();
  const [kindIndex, setKindIndex] = useState(0);
  const claimed = status?.state === "claimed";

  useEffect(() => mutate(), [mutate]);
  useEffect(() => {
    if (claimed) queryClient.invalidateQueries({ queryKey: deviceKeys.list() });
  }, [claimed, queryClient]);

  if (start.isError) {
    return <p className="text-destructive text-sm">{start.error.message}</p>;
  }
  if (start.isPending || !offer) {
    return <div className="bg-muted/40 h-64 animate-pulse rounded-lg" />;
  }

  if (claimed && status?.state === "claimed") {
    return (
      <div className="bg-muted/40 flex flex-col items-center gap-3 rounded-lg p-6 text-center">
        <CheckCircle2 className="text-primary h-8 w-8" />
        <p className="text-sm font-medium">{status.name} is paired</p>
        <Button onClick={onDone} className="h-11 sm:h-9">
          Done
        </Button>
      </div>
    );
  }

  const expired = status?.state === "expired";
  const shown = offer.links[Math.min(kindIndex, offer.links.length - 1)];

  return (
    <div className="bg-muted/40 space-y-3 rounded-lg p-4">
      {shown ? (
        <>
          <p className="text-sm">
            Scan with the phone or tablet&apos;s camera. On a laptop, open the
            link and type the code.
          </p>
          {offer.links.length > 1 && (
            <div className="bg-background/60 mx-auto flex w-fit gap-1 rounded-lg p-1">
              {offer.links.map((l, i) => (
                <button
                  key={l.kind}
                  onClick={() => setKindIndex(i)}
                  className={`h-11 rounded-md px-3 text-xs sm:h-8 ${i === kindIndex ? "bg-muted text-foreground" : "text-muted-foreground"}`}
                >
                  {l.kind === "lan"
                    ? "Phone on this Wi-Fi"
                    : "Phone on Tailscale"}
                </button>
              ))}
            </div>
          )}
          <div
            className="mx-auto w-52 rounded-lg bg-white p-2"
            dangerouslySetInnerHTML={{ __html: shown.svg }}
          />
          <p className="text-muted-foreground text-center text-xs break-all">
            {LABEL[shown.kind]}: {shown.base}/pair
          </p>
        </>
      ) : (
        <p className="text-sm">
          No other device can reach this machine yet. Turn on Wi-Fi access
          below, or set up Tailscale to use it from anywhere.
        </p>
      )}
      <p className="text-center font-mono text-lg tracking-wider">
        {offer.display}
      </p>
      <div className="text-muted-foreground flex items-center justify-center gap-2 text-xs">
        {expired ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => mutate()}
            className="h-11 sm:h-8"
          >
            Code expired. Make a new one
          </Button>
        ) : (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            Waiting for the device. The code works once, for 10 minutes.
          </>
        )}
      </div>
    </div>
  );
}
