"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Globe } from "lucide-react";
import { CopyButton } from "@/components/Chat/CopyButton";
import { canManageDevices } from "@/components/Devices/DevicesPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  useDevicesQuery,
  useLinkConnect,
  useNetworkQuery,
  useUpdateNetwork,
} from "@/data/devices";
import { CONNECT_SITE, CONNECT_STATE, connectView } from "@/lib/connect/view";
import { Block } from "./Block";

const COMMAND = "agent-os connect";

function Command() {
  return (
    <div className="text-muted-foreground flex items-center gap-1 text-xs">
      <span>Or run</span>
      <code className="text-foreground font-mono">{COMMAND}</code>
      <span>in a terminal.</span>
      <CopyButton text={COMMAND} label="Copy command" />
    </div>
  );
}

function LinkForm() {
  const [code, setCode] = useState("");
  const link = useLinkConnect();
  const submit = () => {
    if (code.trim() && !link.isPending) link.mutate(code.trim());
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-muted-foreground text-xs">
        Get a code at{" "}
        <a
          href={CONNECT_SITE}
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground inline-flex items-center gap-1 underline underline-offset-2"
        >
          runagentos.com
          <ExternalLink className="size-3" />
        </a>{" "}
        (Connect a machine), then paste it here.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-label="Link code"
          placeholder="Link code"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="min-h-11 flex-1 font-mono sm:min-h-9"
        />
        <Button
          type="submit"
          variant="outline"
          className="min-h-11 sm:min-h-9"
          disabled={!code.trim() || link.isPending}
        >
          {link.isPending ? "Linking…" : "Link"}
        </Button>
      </form>
      {link.error && (
        <p className="text-destructive text-xs">{link.error.message}</p>
      )}
      <Command />
    </div>
  );
}

/** This machine's Connect: link it, then turn it on or off. */
export function ConnectBlock() {
  // The running server follows a change within a couple of seconds.
  const [wanted, setWanted] = useState<boolean | null>(null);
  const network = useNetworkQuery(true, wanted === null ? false : 2000);
  const devices = useDevicesQuery(true);
  const update = useUpdateNetwork();
  const canManage = canManageDevices(devices.data?.current.via);
  const view = network.data ? connectView(network.data.connect) : null;

  useEffect(() => {
    if (wanted === null) return;
    const t = setTimeout(() => setWanted(null), 6000);
    return () => clearTimeout(t);
  }, [wanted]);

  return (
    <Block
      icon={Globe}
      title="Use it away from home"
      detail="Connect gives this machine a private address at runagentos.com, so your phone reaches it from anywhere. Nothing to open on your router."
    >
      {network.isPending ? (
        <div className="bg-muted/40 h-12 animate-pulse rounded-lg" />
      ) : network.isError || !view ? (
        <p className="text-destructive text-xs">
          {network.error?.message ?? "Couldn't read Connect."}
        </p>
      ) : !view.linked ? (
        canManage ? (
          <LinkForm />
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-xs">
              Link it on the machine running AgentOS.
            </p>
            <Command />
          </div>
        )
      ) : (
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              Linked{" "}
              <span className="text-muted-foreground font-normal">
                · {CONNECT_STATE[network.data.connect.state]}
              </span>
            </p>
            <p className="text-muted-foreground text-xs break-all">
              {view.hostname ? (
                <>
                  Reachable at{" "}
                  <span className="text-foreground font-mono">
                    https://{view.hostname}
                  </span>
                </>
              ) : (
                "The address appears once the tunnel starts."
              )}
              {network.data.connect.reason &&
              network.data.connect.state !== "off"
                ? ` ${network.data.connect.reason.replace(/\.$/, "")}.`
                : ""}
            </p>
            {update.error && (
              <p className="text-destructive text-xs">{update.error.message}</p>
            )}
          </div>
          <Switch
            checked={wanted ?? view.on}
            disabled={!view.canToggle || !canManage}
            onCheckedChange={(connect) => {
              setWanted(connect);
              update.mutate({ connect });
            }}
            className="mt-0.5"
            aria-label="Connect"
          />
        </div>
      )}
    </Block>
  );
}
