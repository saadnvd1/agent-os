"use client";

import { Globe } from "lucide-react";
import type { TailscaleState } from "@/lib/tailscale";

const DOWNLOAD = "https://tailscale.com/download";

export function TailscaleCard({ tailscale }: { tailscale: TailscaleState }) {
  let body: React.ReactNode;
  switch (tailscale.state) {
    case "running": {
      const url = `http://${tailscale.dnsName ?? tailscale.ips[0]}:${window.location.port || 3011}`;
      body = (
        <>
          Reachable from anywhere on your tailnet at{" "}
          <span className="text-foreground font-mono break-all">{url}</span>.
          Install Tailscale on your phone and sign in to the same account to use
          it there.
        </>
      );
      break;
    }
    case "logged-out":
      body = (
        <>Tailscale is installed but not signed in. Open it and sign in.</>
      );
      break;
    case "unknown":
      body = (
        <>
          This machine has a {tailscale.ips[0]} address, which may be Tailscale.
          Install the Tailscale command line to confirm.
        </>
      );
      break;
    default:
      body = (
        <>
          Free, and takes two minutes: install{" "}
          <a
            href={DOWNLOAD}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline"
          >
            Tailscale
          </a>{" "}
          on this machine and your phone, and sign in to the same account on
          both.
        </>
      );
  }

  return (
    <div className="bg-muted/40 flex items-start gap-3 rounded-lg px-3 py-2.5">
      <Globe className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Use it away from home</p>
        <p className="text-muted-foreground text-xs">{body}</p>
      </div>
    </div>
  );
}
