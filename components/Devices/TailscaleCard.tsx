"use client";

import { SettingRow } from "@/components/Settings/SettingRow";
import { Address } from "./ConnectCard";
import type { TailscaleState } from "@/lib/tailscale";

const DOWNLOAD = "https://tailscale.com/download";

export function TailscaleCard({ tailscale }: { tailscale: TailscaleState }) {
  let body: React.ReactNode;
  switch (tailscale.state) {
    case "running": {
      const url = `http://${tailscale.dnsName ?? tailscale.ips[0]}:${window.location.port || 3011}`;
      body = (
        <>
          Reachable from anywhere on your tailnet at <Address>{url}</Address>.
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
    <SettingRow
      id="tailscale"
      label="Use it away from home"
      help={body}
      control={null}
    />
  );
}
