"use client";

import { useState } from "react";
import { useSnapshot } from "valtio";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useConnectWithToken,
  useDisconnect,
  useLumifyHubStatus,
  useStartConnect,
} from "@/data/lumifyhub";
import { lumifyhubUi, lumifyhubUiActions } from "@/stores/lumifyhubUi";

export function ConnectDialog() {
  const { connectOpen } = useSnapshot(lumifyhubUi);
  const { data: status } = useLumifyHubStatus();
  const connected = !!status?.connected;

  return (
    <Dialog
      open={connectOpen}
      onOpenChange={(o) => !o && lumifyhubUiActions.closeConnect()}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {connected ? "LumifyHub" : "Docs & boards in LumifyHub"}
          </DialogTitle>
          <DialogDescription>
            {connected
              ? "Workspaces you link keep their boards and docs in LumifyHub."
              : "Keep this workspace's docs and boards in LumifyHub, where you can open them anywhere and share them with anyone. Tasks show up as cards."}
          </DialogDescription>
        </DialogHeader>
        {connected ? <ConnectedAccount /> : <ConnectOptions />}
      </DialogContent>
    </Dialog>
  );
}

function ConnectOptions() {
  const start = useStartConnect();
  const paste = useConnectWithToken();
  const [pasting, setPasting] = useState(false);
  const [token, setToken] = useState("");
  const error = start.error?.message || paste.error?.message;

  return (
    <div className="space-y-4">
      <Button
        className="h-11 w-full sm:h-9"
        disabled={start.isPending}
        onClick={() => start.mutate()}
      >
        {start.isPending ? "Opening LumifyHub..." : "Connect LumifyHub"}
      </Button>
      {pasting ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            paste.mutate(token, { onSuccess: () => setToken("") });
          }}
        >
          <Input
            autoFocus
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="lhcli_..."
            aria-label="LumifyHub CLI token"
            className="h-11 font-mono sm:h-9"
          />
          <p className="text-muted-foreground text-xs">
            Create one in LumifyHub under Account settings → CLI.
          </p>
          <div className="flex justify-end">
            <Button
              type="submit"
              variant="outline"
              disabled={!token.trim() || paste.isPending}
            >
              {paste.isPending ? "Checking..." : "Connect with token"}
            </Button>
          </div>
        </form>
      ) : (
        <Button
          variant="ghost"
          className="text-muted-foreground h-11 w-full sm:h-9"
          onClick={() => setPasting(true)}
        >
          Use a token instead
        </Button>
      )}
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}

function ConnectedAccount() {
  const { data: status } = useLumifyHubStatus();
  const disconnect = useDisconnect();
  const user = status?.user;

  return (
    <div className="space-y-4">
      <div className="bg-foreground/[0.03] rounded-xl px-3 py-3">
        <p className="text-sm font-medium">
          {user?.name || user?.email || "Connected"}
        </p>
        <p className="text-muted-foreground truncate font-mono text-[11px]">
          {user?.name && user.email ? `${user.email} · ` : ""}
          {status?.baseUrl.replace(/^https?:\/\//, "")}
        </p>
      </div>
      <p className="text-muted-foreground text-xs">
        Disconnecting removes the token from this machine. Revoke it in
        LumifyHub under Account settings → CLI.
      </p>
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => lumifyhubUiActions.closeConnect()}
        >
          Close
        </Button>
        <Button
          variant="outline"
          className="text-destructive"
          disabled={disconnect.isPending}
          onClick={() =>
            disconnect.mutate(undefined, {
              onSuccess: () => lumifyhubUiActions.closeConnect(),
            })
          }
        >
          {disconnect.isPending ? "Disconnecting..." : "Disconnect"}
        </Button>
      </div>
    </div>
  );
}
