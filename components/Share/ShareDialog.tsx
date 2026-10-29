"use client";

import { useEffect, useRef, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { writeClipboard } from "@/hooks/useCopyToClipboard";
import {
  useCreateShare,
  useSharePreview,
  type ShareExpiry,
  type SharePreview,
} from "@/data/shares";
import { shareUi, shareUiActions } from "@/stores/shareUi";
import { exportUiActions } from "@/stores/exportUi";
import {
  DEFAULT_EXPIRY,
  EXPIRIES,
  EXPIRY_LABEL,
  TYPE_LABEL,
  formatBytes,
  nothingLeft,
  redactionSummary,
  toggleDrop,
} from "@/lib/share/view";

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
          key={target.sessionId ?? target.artifactId}
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
  };
}) {
  const [tools, setTools] = useState(false);
  const [dropped, setDropped] = useState<string[]>([]);
  const [expiresIn, setExpiresIn] = useState<ShareExpiry>(DEFAULT_EXPIRY);
  const [preview, setPreview] = useState<SharePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"page" | "markdown">("page");
  const previewReq = useSharePreview();
  const create = useCreateShare();
  const seq = useRef(0);

  const { kind, sessionId, artifactId } = target;
  useEffect(() => {
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const p = await previewReq.mutateAsync({
          kind,
          sessionId,
          artifactId,
          includeTools: tools,
          dropIds: dropped,
        });
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
  }, [kind, sessionId, artifactId, tools, dropped]);

  const toggle = (id: string) => setDropped((d) => toggleDrop(d, id));

  const makeLink = async () => {
    if (!preview) return;
    try {
      const res = await create.mutateAsync({
        kind,
        sessionId,
        artifactId,
        includeTools: tools,
        dropIds: dropped,
        sharedAt: preview.sharedAt,
        hash: preview.hash,
        expiresIn,
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
  const empty =
    kind === "chat" && !!preview && nothingLeft(preview.items, dropped);
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
              <div className="min-h-0">
                <div className="text-muted-foreground mb-1 text-xs font-medium">
                  Messages
                </div>
                <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border">
                  {preview?.items.map((item) => (
                    <li key={item.id}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-1.5 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0"
                          checked={!dropped.includes(item.id)}
                          onChange={() => toggle(item.id)}
                        />
                        <span className="text-muted-foreground w-12 shrink-0 text-xs">
                          {TYPE_LABEL[item.type] ?? item.type}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {item.excerpt || "(empty)"}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            </>
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
              title={target.title}
              disabled={!preview || preview.tooBig || empty}
              request={{
                kind,
                sessionId,
                artifactId,
                includeTools: tools,
                dropIds: dropped,
              }}
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
