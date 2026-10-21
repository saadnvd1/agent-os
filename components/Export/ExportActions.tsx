"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Download, Loader2, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { writeClipboard } from "@/hooks/useCopyToClipboard";
import { fetchExport, type ExportEstimate } from "@/data/exports";
import type { ExportRequest } from "@/lib/export/view";

type Busy = "copy" | "download" | "share" | null;

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// Copy for agent, Download and (where the browser can) Share. Never blocked
// by a sensitive-data warning, only by the size limit.
export function ExportActions({
  sessionId,
  title,
  req,
  est,
}: {
  sessionId: string;
  title: string;
  req: ExportRequest;
  est: ExportEstimate | null;
}) {
  const [busy, setBusy] = useState<Busy>(null);
  const [copied, setCopied] = useState(false);
  // Only rendered on the client (the sheet loads with ssr off).
  const [canShare] = useState(() => {
    try {
      const probe = new File([""], "x.md", { type: "text/markdown" });
      return !!navigator.canShare?.({ files: [probe] });
    } catch {
      return false;
    }
  });

  const wire = JSON.parse(JSON.stringify(req)) as ExportRequest;
  const file = () => fetchExport(sessionId, wire, title, est?.selected ?? null);
  const disabled = !est || est.tooBig || busy !== null;

  const run =
    (kind: Exclude<Busy, null>, work: () => Promise<void>) => async () => {
      setBusy(kind);
      try {
        await work();
      } catch (err) {
        if ((err as Error).name !== "AbortError")
          toast.error((err as Error).message || "Export failed");
      } finally {
        setBusy(null);
      }
    };

  const copy = run("copy", async () => {
    const pending = file();
    // Safari only allows a copy started inside the tap: hand it the promise.
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": pending.then(
            (f) => new Blob([f.blob], { type: "text/plain" })
          ),
        }),
      ]);
    } else {
      await writeClipboard(await (await pending).blob.text());
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    toast.success("Copied. Paste it into your AI chat.");
  });

  const download = run("download", async () => {
    const f = await file();
    save(f.blob, f.name);
  });

  const share = run("share", async () => {
    const f = await file();
    const shared = new File([f.blob], f.name, { type: f.blob.type });
    if (!navigator.canShare?.({ files: [shared] })) return save(f.blob, f.name);
    await navigator.share({ files: [shared], title });
  });

  const Spin = <Loader2 className="h-4 w-4 animate-spin" />;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
      <Button
        className="min-h-11 sm:order-last"
        disabled={disabled}
        onClick={copy}
      >
        {busy === "copy" ? (
          Spin
        ) : copied ? (
          <Check className="h-4 w-4" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
        {req.format === "md" ? "Copy for agent" : "Copy"}
      </Button>
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="min-h-11 flex-1 sm:flex-none"
          disabled={disabled}
          onClick={download}
        >
          {busy === "download" ? Spin : <Download className="h-4 w-4" />}
          Download
        </Button>
        {canShare && (
          <Button
            variant="outline"
            className="min-h-11 flex-1 sm:flex-none"
            disabled={disabled}
            onClick={share}
          >
            {busy === "share" ? Spin : <Share2 className="h-4 w-4" />}
            Share…
          </Button>
        )}
      </div>
    </div>
  );
}
