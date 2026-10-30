"use client";

import { useEffect, useState } from "react";
import { useSnapshot } from "valtio";
import { Check, Copy, ExternalLink, Share, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { ShimmeringLoader as Skeleton } from "@/components/ui/skeleton";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import {
  useCreateLive,
  useEndLive,
  useLiveShare,
  type LiveExpiry,
  type LiveInvite,
  type LiveLevel,
  type LiveView,
} from "@/data/live";
import { EXPIRY_LABEL } from "@/lib/live/types";
import { liveUi, liveUiActions } from "@/stores/liveUi";

// "Invite to watch live" on a chat: a link for one guest-facing page, with
// the host deciding who comes in and what reaches the agent.
export function InviteDialog() {
  const { target } = useSnapshot(liveUi);
  return (
    <Dialog
      open={!!target}
      onOpenChange={(open) => !open && liveUiActions.close()}
    >
      {target && <InviteBody sessionId={target.sessionId} />}
    </Dialog>
  );
}

function InviteBody({ sessionId }: { sessionId: string }) {
  const query = useLiveShare(sessionId);
  const share = query.data?.share;
  return (
    <DialogContent className="flex max-h-[100dvh] w-screen max-w-none flex-col gap-4 overflow-y-auto rounded-none p-4 sm:max-w-md sm:rounded-lg">
      <div>
        <DialogTitle>Invite to watch live</DialogTitle>
        <DialogDescription>
          A guest opens the link, types a name and waits for you to let them in.
          They see this chat as it happens, with secrets masked. You choose what
          else they can do.
        </DialogDescription>
      </div>
      {query.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : !query.data?.linked ? (
        <Notice tone="warning">
          Link this machine in Settings → Devices &amp; access to invite people.
        </Notice>
      ) : share ? (
        <Link share={share} />
      ) : (
        <Create sessionId={sessionId} invite={query.data.invite} />
      )}
    </DialogContent>
  );
}

function Create({
  sessionId,
  invite,
}: {
  sessionId: string;
  invite?: LiveInvite;
}) {
  const [expiresIn, setExpiresIn] = useState<LiveExpiry>("1h");
  const [level, setLevel] = useState<LiveLevel>("suggest");
  const [history, setHistory] = useState<boolean | null>(null);
  const [codeOn, setCodeOn] = useState<boolean | null>(null);
  const [custom, setCustom] = useState("");
  const create = useCreateLive();
  const options = invite?.levels ?? [];
  const chosen = options.find((o) => o.value === level);
  const withHistory = history ?? invite?.history.default ?? true;
  const withCode = codeOn ?? invite?.code.default ?? false;
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-xs font-medium">
          What guests can do
        </span>
        <Segmented
          label="Access"
          value={level}
          onChange={setLevel}
          options={options.map((o) => ({
            value: o.value,
            label: o.label,
            hint: o.reason ?? o.hint,
            disabled: !o.enabled,
          }))}
        />
        <p className="text-muted-foreground text-xs">
          {chosen?.hint}
          {options
            .filter((o) => !o.enabled && o.reason)
            .map((o) => ` ${o.label}: ${o.reason}.`)
            .join("")}
        </p>
      </div>
      {invite && (
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={withHistory}
            onChange={(e) => setHistory(e.target.checked)}
          />
          {invite.history.label}
        </label>
      )}
      {invite && (
        <div className="flex flex-col gap-1.5">
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5"
              checked={withCode}
              onChange={(e) => setCodeOn(e.target.checked)}
            />
            {invite.code.label}
          </label>
          {withCode && (
            <>
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                maxLength={40}
                autoComplete="off"
                spellCheck={false}
                placeholder={invite.code.customLabel}
                aria-label={invite.code.customLabel}
                className="bg-muted min-h-11 rounded-lg px-3 font-mono text-sm"
              />
              <p className="text-muted-foreground text-xs">
                {invite.code.hint} {invite.code.rules}
              </p>
            </>
          )}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-xs font-medium">
          The link works for
        </span>
        <Segmented
          label="Expiry"
          value={expiresIn}
          onChange={setExpiresIn}
          options={(["1h", "session"] as const).map((v) => ({
            value: v,
            label: EXPIRY_LABEL[v],
          }))}
        />
      </div>
      {create.error && (
        <p className="text-destructive text-sm">{create.error.message}</p>
      )}
      <Button
        className="min-h-11"
        disabled={create.isPending}
        onClick={() =>
          create.mutate({
            sessionId,
            expiresIn,
            level,
            history: withHistory,
            code: withCode
              ? custom.trim()
                ? { custom: custom.trim() }
                : {}
              : null,
          })
        }
      >
        <Users className="h-4 w-4" />
        {create.isPending ? "Creating…" : "Create invite link"}
      </Button>
    </>
  );
}

function Link({ share }: { share: LiveView }) {
  const { copied, copy } = useCopyToClipboard();
  const end = useEndLive(share.id);
  const qr = useQr(share.url);
  const code = share.code;
  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  return (
    <>
      <div className="flex flex-col items-center gap-3">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qr}
            alt="QR code for the invite link"
            className="size-40 rounded-lg bg-white p-2"
          />
        ) : (
          <Skeleton className="size-40" />
        )}
        <input
          readOnly
          value={share.url}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Invite link"
          className="bg-muted min-h-11 w-full rounded-lg px-3 font-mono text-xs"
        />
      </div>
      {code.on && code.copyText && (
        <div className="flex flex-col items-center gap-2">
          <span className="text-muted-foreground text-xs font-medium">
            {code.label}
          </span>
          <span
            className="font-mono text-3xl font-semibold tracking-widest"
            aria-label={code.label}
          >
            {code.display}
          </span>
          <Button
            className="min-h-11 w-full"
            onClick={() => copy(code.copyText!)}
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            Copy link and code
          </Button>
          <p className="text-muted-foreground text-center text-xs">
            {code.hint}
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="min-h-11 flex-1"
          onClick={() => copy(share.url)}
        >
          {copied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          Copy link
        </Button>
        {canShare && (
          <Button
            variant="outline"
            className="min-h-11 flex-1"
            onClick={() =>
              navigator
                .share({ title: share.title, url: share.url })
                .catch(() => {})
            }
          >
            <Share className="h-4 w-4" />
            Share
          </Button>
        )}
        <Button variant="outline" className="min-h-11 flex-1" asChild>
          <a href={share.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" />
            Open
          </a>
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        {share.endsWithSession
          ? "Works until you end access or the session ends."
          : share.expiresAt
            ? `Works until ${new Date(share.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`
            : ""}{" "}
        Requests and suggestions show above the message box.
      </p>
      {end.error && (
        <p className="text-destructive text-sm">{end.error.message}</p>
      )}
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="text-destructive min-h-11 flex-1"
          disabled={end.isPending}
          onClick={() => end.mutate()}
        >
          End access
        </Button>
        <Button className="min-h-11 flex-1" onClick={liveUiActions.close}>
          Done
        </Button>
      </div>
    </>
  );
}

// The code is drawn here, in the browser: the link goes to no outside service.
function useQr(url: string): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    import("qrcode")
      .then((m) =>
        m.toDataURL(url, { margin: 0, width: 256, errorCorrectionLevel: "M" })
      )
      .then((data) => live && setSrc(data))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [url]);
  return src;
}
