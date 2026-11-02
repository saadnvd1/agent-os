"use client";

import { SettingRow } from "@/components/Settings/SettingRow";
import { SwitchSetting } from "@/components/Settings/settings-fields";
import type { ConnectStatus } from "@/lib/connect/serve";
import {
  CONNECT_SIGN_UP,
  CONNECT_STATE as STATE,
  connectView,
} from "@/lib/connect/view";

// An address is one token: keep it whole and cut it with an ellipsis rather
// than through a letter.
export const Address = ({ children }: { children: string }) => (
  <span className="text-foreground inline-block max-w-full truncate align-bottom font-mono">
    {children}
  </span>
);

export function ConnectCard({
  connect,
  canManage,
  onToggle,
}: {
  connect: ConnectStatus;
  canManage: boolean;
  onToggle: (on: boolean) => Promise<unknown>;
}) {
  const { linked: enrolled, on } = connectView(connect);
  const label = `Connect · ${STATE[connect.state]}`;
  const help = (
    <>
      {connect.hostname ? (
        <>
          Reachable from anywhere at{" "}
          <Address>{`https://${connect.hostname}`}</Address>. Cloudflare carries
          the connection; every request still needs a paired device.
        </>
      ) : enrolled ? (
        <>Linked. The address appears once the tunnel starts.</>
      ) : (
        <>
          Not set up on this machine. Run{" "}
          <code className="text-foreground font-mono">agent-os connect</code> in
          a terminal.{" "}
          <a
            href={CONNECT_SIGN_UP}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline underline-offset-2"
          >
            Set up Connect (free)
          </a>
        </>
      )}
      {connect.reason && connect.state !== "off"
        ? ` ${connect.reason.replace(/\.$/, "")}.`
        : ""}
    </>
  );
  if (!enrolled)
    return <SettingRow id="connect" label={label} help={help} control={null} />;
  return (
    <SwitchSetting
      id="connect"
      label={label}
      help={help}
      checked={on}
      locked={!canManage || connect.state === "refused"}
      onSave={onToggle}
    />
  );
}
