"use client";

import { useState } from "react";
import { AlertTriangle, Check, Loader2, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import { useBookmarkChat } from "@/components/Bookmarks/context";
import { useChatItem } from "@/components/Chat/itemContext";
import {
  useAskAgain,
  useDismissRecommendation,
  useSendRecommendation,
  useSessionAnalyst,
} from "@/data/analyst";
import { parseReviewJson } from "@/lib/analyst/parseReview";
import type { Issue, Recommendation } from "@/lib/analyst/types";
import { cn } from "@/lib/utils";
import { cardView } from "./cardState";
import { SignalChips } from "./SignalChips";

const SEVERITY_DOT: Record<Issue["severity"], string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-muted-foreground/50",
};

const fail = (e: Error) => toast.error(e.message);

/**
 * An analyst's `agentos-review` block, drawn as a card: its summary, the
 * issues it flagged and the prompt it recommends, with Send to Coding Agent,
 * Edit and Dismiss while the stored card is open.
 */
export function ReviewCard({ code }: { code: string }) {
  const item = useChatItem();
  const sessionId = useBookmarkChat()?.sessionId;
  const { data: link } = useSessionAnalyst(sessionId);
  const parsed = parseReviewJson(code);
  const rec =
    (item &&
      link &&
      link.analyst.id === sessionId &&
      link.recommendations.find((r) => r.analystItemId === item.itemId)) ||
    null;

  if (!parsed.ok)
    return (
      <div className="bg-foreground/[0.04] text-muted-foreground not-prose my-3 space-y-2 rounded-xl px-3 py-2.5 text-xs">
        <div className="flex items-center gap-2">
          {item?.streaming ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Writing the
              review…
            </>
          ) : (
            <>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              {parsed.error}
            </>
          )}
        </div>
        {rec && link && !item?.streaming && (
          <Actions
            linkId={link.id}
            coderName={link.coder.name}
            rec={rec}
            prompt={null}
            view={cardView(rec, null, link.coderLastTurn)}
          />
        )}
      </div>
    );

  const review = parsed.review;
  const view = cardView(
    rec,
    rec?.verdict ?? review.verdict,
    link?.coderLastTurn ?? null
  );

  return (
    <div className="bg-card hairline not-prose my-3 space-y-3 rounded-xl p-3 text-sm">
      <div className="flex items-center gap-2">
        <StatusPill tone={view.tone}>{view.label}</StatusPill>
        <span className="text-muted-foreground text-xs">Analyst review</span>
      </div>
      <p className="leading-relaxed">{review.summary}</p>
      {rec?.signals && <SignalChips signals={rec.signals} />}
      {review.issues.length > 0 && (
        <ul className="space-y-2">
          {review.issues.map((issue, i) => (
            <li key={i} className="flex gap-2">
              <span
                aria-label={`${issue.severity} severity`}
                className={cn(
                  "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                  SEVERITY_DOT[issue.severity]
                )}
              />
              <div className="min-w-0">
                <div className="font-medium">{issue.title}</div>
                {issue.where && (
                  <div className="text-muted-foreground truncate font-mono text-[11px]">
                    {issue.where}
                  </div>
                )}
                {issue.detail && (
                  <div className="text-muted-foreground text-xs leading-relaxed">
                    {issue.detail}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {view.notes.map((note) => (
        <div
          key={note}
          className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-400"
        >
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          {note}
        </div>
      ))}
      {rec && link ? (
        <Actions
          linkId={link.id}
          coderName={link.coder.name}
          rec={rec}
          prompt={review.prompt ?? null}
          view={view}
        />
      ) : (
        review.prompt && <PromptBox text={review.prompt} />
      )}
    </div>
  );
}

function PromptBox({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <div
      className={cn(
        "bg-foreground/[0.04] max-h-60 overflow-y-auto rounded-lg px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap",
        muted && "text-muted-foreground"
      )}
    >
      {text}
    </div>
  );
}

function Actions({
  linkId,
  coderName,
  rec,
  prompt,
  view,
}: {
  linkId: string;
  coderName: string;
  rec: Recommendation;
  prompt: string | null;
  view: ReturnType<typeof cardView>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const send = useSendRecommendation(linkId);
  const dismiss = useDismissRecommendation(linkId);
  const again = useAskAgain(linkId);
  const busy = send.isPending || dismiss.isPending || again.isPending;

  if (rec.state === "sent")
    return (
      <div className="space-y-1.5">
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Check className="h-3.5 w-3.5 text-green-500" /> Sent to {coderName}
        </div>
        {rec.sentText && <PromptBox text={rec.sentText} muted />}
      </div>
    );

  if (draft !== null)
    return (
      <div className="space-y-2">
        <Textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Prompt for the coding agent"
          className="min-h-[160px]"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="h-11 md:h-8"
            disabled={busy || !draft.trim()}
            onClick={() =>
              send.mutate(
                { recId: rec.id, text: draft.trim() },
                { onError: fail, onSuccess: () => setDraft(null) }
              )
            }
          >
            <Send /> Send to Coding Agent
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-11 md:h-8"
            onClick={() => setDraft(null)}
          >
            Cancel
          </Button>
        </div>
      </div>
    );

  return (
    <div className="space-y-2">
      {prompt && <PromptBox text={prompt} muted={rec.state !== "open"} />}
      <div className="flex flex-wrap gap-2">
        {view.canSend && (
          <Button
            size="sm"
            className="h-11 md:h-8"
            disabled={busy}
            onClick={() => send.mutate({ recId: rec.id }, { onError: fail })}
          >
            {send.isPending ? <Loader2 className="animate-spin" /> : <Send />}
            Send to Coding Agent
          </Button>
        )}
        {view.canWrite && (
          <Button
            size="sm"
            variant="outline"
            className="h-11 md:h-8"
            disabled={busy}
            onClick={() => setDraft(prompt ?? "")}
          >
            {view.canSend ? "Edit" : "Ask coding agent anyway"}
          </Button>
        )}
        {view.canAskAgain && (
          <Button
            size="sm"
            variant="outline"
            className="h-11 md:h-8"
            disabled={busy}
            onClick={() => again.mutate(rec.id, { onError: fail })}
          >
            <RotateCcw /> Ask again
          </Button>
        )}
        {view.canDismiss && (
          <Button
            size="sm"
            variant="ghost"
            className="h-11 md:h-8"
            disabled={busy}
            onClick={() => dismiss.mutate(rec.id, { onError: fail })}
          >
            Dismiss
          </Button>
        )}
      </div>
    </div>
  );
}
