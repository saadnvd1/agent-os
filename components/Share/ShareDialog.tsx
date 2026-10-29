"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSnapshot } from "valtio";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DownloadMenu } from "./DownloadMenu";
import { MessageList } from "./MessageList";
import { RangePicker } from "./RangePicker";
import { useCoarsePointer } from "@/components/Chat/composer/useCoarsePointer";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { writeClipboard } from "@/hooks/useCopyToClipboard";
import {
  useCreateShare,
  useShareMessages,
  useSharePreview,
  type PreviewItem,
  type PreviewRequest,
  type ShareExpiry,
  type SharePreview,
} from "@/data/shares";
import { shareUi, shareUiActions } from "@/stores/shareUi";
import { exportUiActions } from "@/stores/exportUi";
import {
  DEFAULT_EXPIRY,
  EXPIRIES,
  EXPIRY_LABEL,
  formatBytes,
  redactionSummary,
  toggleDrop,
} from "@/lib/share/view";
import {
  DEFAULT_PRESET,
  activePreset,
  clickRange,
  inRange,
  presetRange,
  rangeFromHere,
  rangeSummary,
  type RangePreset,
  type ShareRange,
} from "@/lib/share/range";

// Opened from a menu or an artifact: the redacted page exactly as it would be
// uploaded, with what to leave out, then Create link or Download.
export function ShareDialog() {
  const { target } = useSnapshot(shareUi);
  return (
    <Dialog
      open={!!target}
      onOpenChange={(open) => !open && shareUiActions.close()}
    >
      {target && (
        <ShareBody
          key={`${target.sessionId ?? target.artifactId}:${target.fromId ?? ""}`}
          target={{ ...target }}
        />
      )}
    </Dialog>
  );
}

function ShareBody({
  target,
}: {
  target: {
    kind: "chat" | "artifact";
    sessionId?: string;
    artifactId?: string;
    title: string;
    version?: number;
    fromId?: string;
  };
}) {
  const [tools, setTools] = useState(false);
  const [dropped, setDropped] = useState<string[]>([]);
  const [expiresIn, setExpiresIn] = useState<ShareExpiry>(DEFAULT_EXPIRY);
  const [preview, setPreview] = useState<SharePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [follow, setFollow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"page" | "markdown">("page");
  const [rows, setRows] = useState<PreviewItem[] | null>(null);
  const [range, setRange] = useState<ShareRange | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const previewReq = useSharePreview();
  const listReq = useShareMessages();
  const create = useCreateShare();
  const coarse = useCoarsePointer();
  const seq = useRef(0);

  const { kind, sessionId, artifactId } = target;
  const chat = kind === "chat";

  // A chat opens on its last exchange, or on the message it was shared from.
  useEffect(() => {
    if (!chat) return;
    let live = true;
    listReq
      .mutateAsync({ kind, sessionId, includeTools: true })
      .then(({ items }) => {
        if (!live) return;
        const from = target.fromId ? rangeFromHere(items, target.fromId) : null;
        setRows(items);
        setRange(from ?? presetRange(items, DEFAULT_PRESET, new Date()));
        setAnchor(from?.fromId ?? null);
      })
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
    // listReq is stable enough; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat, kind, sessionId, target.fromId]);

  const ready =
    !chat || (rows !== null && range !== null) || rows?.length === 0;
  const request: PreviewRequest = useMemo(
    () => ({
      kind,
      sessionId,
      artifactId,
      includeTools: tools,
      dropIds: dropped,
      ...(range ?? {}),
    }),
    [kind, sessionId, artifactId, tools, dropped, range]
  );

  useEffect(() => {
    if (!ready) return;
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const p = await previewReq.mutateAsync(request);
        if (mine === seq.current) {
          setPreview(p);
          setError(null);
        }
      } catch (err) {
        if (mine === seq.current) setError((err as Error).message);
      }
    }, 250);
    return () => clearTimeout(timer);
    // previewReq is stable enough; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, request]);

  const toggle = (id: string) => setDropped((d) => toggleDrop(d, id));

  const makeLink = async () => {
    if (!preview) return;
    try {
      const res = await create.mutateAsync({
        ...request,
        sharedAt: preview.sharedAt,
        hash: preview.hash,
        expiresIn,
        follow: follow ? "latest" : undefined,
      });
      setCreated(res.url);
      try {
        await writeClipboard(res.url);
        toast.success("Link copied");
      } catch {
        toast.message("Link created. Copy it below.");
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const copyAgain = async () => {
    if (!created) return;
    try {
      await writeClipboard(created);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  const linked = preview?.connectLinked ?? false;
  const visibleRows = useMemo(
    () => (rows ?? []).filter((r) => tools || !r.tools),
    [rows, tools]
  );
  const covered = useMemo(() => inRange(rows ?? [], range), [rows, range]);
  const inside = useMemo(() => new Set(covered.map((r) => r.id)), [covered]);
  const shared = visibleRows.filter(
    (r) => inside.has(r.id) && !dropped.includes(r.id)
  );
  const empty = chat && !!rows && shared.length === 0;
  const active = activePreset(rows ?? [], range, new Date());

  const pickPreset = (preset: RangePreset) => {
    const r = presetRange(rows ?? [], preset, new Date());
    if (!r) return;
    setRange(r);
    setAnchor(r.fromId);
    setArmed(false);
  };
  const pickRow = (id: string, shift: boolean) => {
    const extend = shift || (coarse && armed);
    setRange(
      clickRange(rows ?? [], anchor ?? range?.fromId ?? null, id, extend)
    );
    if (!extend) setAnchor(id);
    setArmed(coarse && !extend);
  };
  const summary = preview ? redactionSummary(preview.hits) : "";

  return (
    <DialogContent className="flex h-[100dvh] w-screen max-w-none flex-col gap-3 rounded-none p-4 sm:h-[90vh] sm:max-w-5xl sm:rounded-lg">
      <div>
        <DialogTitle>
          Share {kind === "chat" ? "this chat" : "this page"}
          {target.version ? ` · v${target.version}` : ""}
        </DialogTitle>
        <DialogDescription>
          A read-only snapshot, with secrets, home paths and machine names
          masked. Nothing is uploaded until you create the link.
        </DialogDescription>
      </div>

      {chat && rows && rows.length > 0 && (
        <RangePicker
          rows={rows}
          active={active}
          summary={rangeSummary(visibleRows.length, shared)}
          onPick={pickPreset}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto md:flex-row md:overflow-hidden">
        <div className="flex min-h-[45vh] flex-1 flex-col gap-2 md:min-h-0">
          <div className="flex gap-2" role="group" aria-label="Preview format">
            {(["page", "markdown"] as const).map((t) => (
              <Button
                key={t}
                size="sm"
                variant={tab === t ? "default" : "outline"}
                className="min-h-11"
                aria-pressed={tab === t}
                onClick={() => setTab(t)}
              >
                {t === "page" ? "Page" : "Markdown"}
              </Button>
            ))}
          </div>
          <div className="bg-background min-h-0 flex-1 overflow-hidden rounded-lg border">
            {preview && tab === "markdown" ? (
              <pre className="h-full overflow-auto p-4 font-mono text-xs break-words whitespace-pre-wrap">
                {preview.markdown}
              </pre>
            ) : preview ? (
              <iframe
                title="Preview of what will be shared"
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                srcDoc={preview.html}
                className="h-full min-h-[45vh] w-full md:min-h-0"
              />
            ) : (
              <p className="text-muted-foreground p-4 text-sm">
                {error ?? "Preparing the preview…"}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-4 md:w-80 md:overflow-y-auto">
          {kind === "chat" && (
            <>
              <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
                <span>Include tool calls and thinking</span>
                <Switch checked={tools} onCheckedChange={setTools} />
              </label>
              <MessageList
                rows={visibleRows}
                inside={inside}
                dropped={dropped}
                touch={coarse}
                onPick={pickRow}
                onToggle={toggle}
              />
            </>
          )}

          {linked && kind === "artifact" && (
            <fieldset className="space-y-2">
              <legend className="text-muted-foreground mb-1 text-xs font-medium">
                What the link shows
              </legend>
              {[
                {
                  value: false,
                  title: `This version${target.version ? ` (v${target.version})` : ""}`,
                  hint: "Never changes. You review it above before it goes out.",
                },
                {
                  value: true,
                  title: "Always the latest",
                  hint: "Updates when the agent makes a new version. New versions are redacted the same way but publish without a fresh preview.",
                },
              ].map((o) => (
                <label
                  key={o.title}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm",
                    follow === o.value && "border-primary bg-primary/5"
                  )}
                >
                  <input
                    type="radio"
                    name="share-follow"
                    className="mt-1 h-4 w-4 shrink-0"
                    checked={follow === o.value}
                    onChange={() => setFollow(o.value)}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{o.title}</span>
                    <span className="text-muted-foreground block text-xs">
                      {o.hint}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          {linked && (
            <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
              <span>Link expires after</span>
              <Select
                value={expiresIn}
                onValueChange={(v) => setExpiresIn(v as ShareExpiry)}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRIES.map((e) => (
                    <SelectItem key={e} value={e}>
                      {EXPIRY_LABEL[e]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}

          {preview && (
            <div className="text-muted-foreground space-y-1 text-xs">
              <p>{summary || "Nothing needed masking."}</p>
              <p>
                Your own machine and network names are masked; public sites like
                github.com are not.
              </p>
              <p>{formatBytes(preview.bytes)}</p>
            </div>
          )}
          {preview?.tooBig && (
            <p className="text-destructive text-sm">
              Too big to share; drop some messages or turn tool calls off.
            </p>
          )}
          {error && preview && (
            <p className="text-destructive text-sm">{error}</p>
          )}
          {kind === "chat" && sessionId && (
            <button
              type="button"
              onClick={() => {
                shareUiActions.close();
                exportUiActions.open(sessionId, target.title);
              }}
              className="text-muted-foreground hover:text-foreground min-h-11 self-start text-xs underline underline-offset-2"
            >
              Export for AI instead…
            </button>
          )}
        </div>
      </div>

      {created ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            readOnly
            value={created}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Shared link"
            className="bg-muted min-h-11 min-w-0 flex-1 rounded-lg px-3 font-mono text-xs"
          />
          <Button variant="outline" className="min-h-11" onClick={copyAgain}>
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            Copy
          </Button>
          <Button variant="outline" className="min-h-11" asChild>
            <a href={created} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
              Open
            </a>
          </Button>
          <Button className="min-h-11" onClick={shareUiActions.close}>
            Done
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          {preview && !linked && (
            <p className="text-muted-foreground order-last text-xs sm:order-first sm:flex-1">
              Link this machine in Settings → Devices &amp; access to share a
              link.
            </p>
          )}
          <div className="flex gap-2">
            <DownloadMenu
              preview={preview}
              title={target.title || preview?.title || ""}
              disabled={!preview || preview.tooBig || empty}
              request={request}
            />
            {linked && (
              <Button
                className="min-h-11 flex-1 sm:flex-none"
                disabled={
                  !preview || preview.tooBig || empty || create.isPending
                }
                onClick={makeLink}
              >
                <Link2 className="h-4 w-4" />
                {create.isPending ? "Creating…" : "Create link"}
              </Button>
            )}
          </div>
        </div>
      )}
    </DialogContent>
  );
}
