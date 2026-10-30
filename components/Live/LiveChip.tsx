"use client";

import { useState } from "react";
import { Check, ChevronDown, Copy, Radio, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { StatusPill } from "@/components/ui/status-pill";
import type { LiveLevel, LiveView } from "@/data/live";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { cn } from "@/lib/utils";

export function presenceText(guests: LiveView["guests"]): string {
  const here = guests.filter((g) => g.status === "admitted" && g.online);
  if (!here.length) return "No one watching yet";
  if (here.length === 1) return `${here[0].name} is watching`;
  return `${here[0].name} +${here.length - 1} watching`;
}

// The session's live state: who is watching, with Kick and End access.
export function LiveChip({
  share,
  busy,
  onAction,
  onLevel,
  onCode,
  onEnd,
  onInvite,
}: {
  share: LiveView;
  busy: boolean;
  onAction: (guestId: string, kind: string) => void;
  onLevel: (level: LiveLevel) => void;
  onCode: (kind: string, own?: string) => void;
  onEnd: () => void;
  onInvite: () => void;
}) {
  const [open, setOpen] = useState(false);
  const admitted = share.guests.filter((g) => g.status === "admitted");
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="hover:bg-muted/60 flex min-h-11 items-center gap-2 rounded-lg px-2 text-left text-xs"
      >
        <StatusPill tone={share.connected ? "green" : "amber"}>
          <Radio className="h-3 w-3" aria-hidden />
          {share.connected ? "Live" : "Reconnecting"}
        </StatusPill>
        <span className="min-w-0 flex-1 truncate">
          {presenceText(share.guests)}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>
      {open && (
        <div className="bg-muted/60 flex flex-col gap-1 rounded-xl p-2 shadow-sm">
          {share.notice && (
            <p className="text-muted-foreground px-2 text-xs">{share.notice}</p>
          )}
          <Segmented
            label="Access"
            value={share.level}
            onChange={onLevel}
            disabled={busy}
            options={share.levels.map((o) => ({
              value: o.value,
              label: o.label,
              hint: o.reason ?? o.hint,
              disabled: !o.enabled,
            }))}
          />
          <p className="text-muted-foreground px-2 text-xs">
            {share.levels.find((o) => o.value === share.level)?.hint}
          </p>
          <CodeRow share={share} busy={busy} onCode={onCode} />
          {admitted.length === 0 && (
            <p className="text-muted-foreground px-2 py-1 text-xs">
              No one has joined yet.
            </p>
          )}
          {admitted.map((g) => (
            <div key={g.id} className="flex min-h-11 items-center gap-2 px-2">
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  g.online ? "bg-green-500" : "bg-muted-foreground/40"
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-sm">{g.name}</span>
              {g.actions.map((a) => (
                <Button
                  key={a.kind}
                  variant="ghost"
                  className="min-h-11"
                  disabled={busy}
                  onClick={() => onAction(g.id, a.kind)}
                  aria-label={`${a.label} ${g.name}`}
                >
                  {a.kind === "kick" && <UserMinus className="h-4 w-4" />}
                  {a.label}
                </Button>
              ))}
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              className="min-h-11 flex-1"
              onClick={onInvite}
            >
              Invite link
            </Button>
            <Button
              variant="outline"
              className="text-destructive min-h-11 flex-1"
              disabled={busy}
              onClick={onEnd}
            >
              End access
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CodeRow({
  share,
  busy,
  onCode,
}: {
  share: LiveView;
  busy: boolean;
  onCode: (kind: string, own?: string) => void;
}) {
  const { copied, copy } = useCopyToClipboard();
  const { code } = share;
  const change = (kind: string) => {
    if (kind === "copy") copy(code.copyText ?? share.url);
    else if (kind === "copy_link") copy(share.url);
    else if (kind === "set_code") {
      const own = window.prompt(`${code.prompt.title}\n${code.prompt.message}`);
      if (own?.trim()) onCode(kind, own.trim());
    } else onCode(kind);
  };
  return (
    <div className="flex flex-col gap-1 px-2 py-1">
      <div className="flex min-h-11 items-center gap-2">
        <span className="text-muted-foreground text-xs">{code.label}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-sm font-semibold tracking-wider">
          {code.on ? code.display : "Off"}
        </span>
        {code.on && code.copyText && (
          <Button
            variant="ghost"
            className="min-h-11"
            onClick={() => copy(code.copyText!)}
            aria-label="Copy link and code"
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>
      {code.notice && (
        <p className="text-muted-foreground text-xs">{code.notice}</p>
      )}
      <div className="flex flex-wrap gap-1">
        {code.actions
          .filter((a) => a.kind !== "copy" && a.kind !== "copy_link")
          .map((a) => (
            <Button
              key={a.kind}
              variant="ghost"
              className="min-h-11"
              disabled={busy}
              onClick={() => change(a.kind)}
            >
              {a.label}
            </Button>
          ))}
      </div>
    </div>
  );
}
