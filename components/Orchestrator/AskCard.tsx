"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, CornerDownLeft, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AskView } from "@/lib/orchestrator/overview";
import type { AskKind } from "@/lib/orchestrator/asks";
import type { AskAction } from "@/data/orchestrators";
import { NO_PASSKEYS_HERE, passkeysHere } from "@/data/presence";
import { cn } from "@/lib/utils";

const amber = "bg-amber-500/15 text-amber-700 dark:text-amber-300";
const muted = "bg-foreground/[0.06] text-muted-foreground";

const KIND: Record<AskKind, { label: string; tone: string }> = {
  decision: { label: "Decision", tone: muted },
  public: { label: "Public", tone: amber },
  money: { label: "Money", tone: amber },
  irreversible: { label: "Irreversible", tone: amber },
  credentials: { label: "Credentials", tone: amber },
  product: { label: "Product call", tone: amber },
  gate: { label: "Merge gate", tone: muted },
  brake: { label: "Brake", tone: muted },
  passkey: { label: "New passkey", tone: amber },
};

// "PR #12" for a pull request, otherwise the host and path.
function linkLabel(link: string): string {
  const pr = /\/pull\/(\d+)/.exec(link);
  if (pr) return `PR #${pr[1]}`;
  try {
    const u = new URL(link);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return link;
  }
}

const noSubscribe = () => () => {};

const safeHref = (link: string) => /^https?:\/\//i.test(link);

export function AskCard({
  ask,
  onAnswer,
  pending = false,
  dense = false,
}: {
  ask: AskView;
  onAnswer: (answer: AskAction) => void;
  pending?: boolean;
  // In the sidebar: the why on one line.
  dense?: boolean;
}) {
  const [replying, setReplying] = useState(false);
  // Known only in the browser: whether this page can use a passkey.
  const canProve = useSyncExternalStore(noSubscribe, passkeysHere, () => true);
  const blocked = ask.presence && !canProve;
  const [text, setText] = useState("");
  const kind = KIND[ask.kind];
  const btn = "h-11 md:h-8";
  const send = () => {
    if (!text.trim()) return;
    onAnswer({ action: "reply", text: text.trim() });
    setReplying(false);
    setText("");
  };

  return (
    <div className="bg-card hairline space-y-2 rounded-xl px-3 py-2.5">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-sm leading-snug font-medium">
          {ask.title}
        </p>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
            kind.tone
          )}
        >
          {kind.label}
        </span>
      </div>
      {ask.why && (
        <p
          className={cn(
            "text-muted-foreground text-xs leading-relaxed",
            dense ? "truncate" : "line-clamp-2"
          )}
          title={ask.detail}
        >
          {ask.why}
        </p>
      )}
      {ask.sha && (
        <p className="text-muted-foreground font-mono text-[11px]">
          at {ask.sha.slice(0, 7)}
        </p>
      )}
      {ask.link &&
        (safeHref(ask.link) ? (
          <a
            href={ask.link}
            target="_blank"
            rel="noreferrer"
            className="text-primary inline-flex min-h-11 items-center gap-1 text-xs font-medium hover:underline md:min-h-0"
          >
            {linkLabel(ask.link)}
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <p className="text-muted-foreground font-mono text-[11px] break-all">
            {ask.link}
          </p>
        ))}
      {blocked && !dense && (
        <p className="text-muted-foreground text-xs">{NO_PASSKEYS_HERE}</p>
      )}
      {replying ? (
        <div className="space-y-2">
          <Textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
            }}
            placeholder="Your answer"
            className="min-h-20 text-sm"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className={cn(btn, "flex-1 md:flex-none")}
              disabled={!text.trim() || pending}
              onClick={send}
            >
              <CornerDownLeft />
              Send
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={btn}
              onClick={() => setReplying(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "grid grid-cols-3 gap-1.5 [&>button]:px-2",
            dense
              ? "[&>button]:text-xs [&>button>svg]:hidden"
              : "md:flex md:[&>button]:px-3"
          )}
        >
          <Button
            size="sm"
            className={btn}
            disabled={pending || blocked}
            title={blocked ? NO_PASSKEYS_HERE : undefined}
            onClick={() => onAnswer({ action: "approve" })}
          >
            <Check />
            Approve
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className={btn}
            disabled={pending}
            onClick={() => onAnswer({ action: "decline" })}
          >
            <X />
            Decline
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={btn}
            disabled={pending}
            onClick={() => setReplying(true)}
          >
            Reply
          </Button>
        </div>
      )}
    </div>
  );
}
