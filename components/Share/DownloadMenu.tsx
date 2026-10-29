"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  Download,
  FileCode,
  FileText,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useSharePdf,
  useSharePreview,
  type PreviewRequest,
  type SharePreview,
} from "@/data/shares";
import { fileName, type ShareFormat } from "@/lib/share/view";

const FORMAT: Record<ShareFormat, { label: string; Icon: LucideIcon }> = {
  pdf: { label: "PDF", Icon: FileText },
  html: { label: "HTML page", Icon: FileCode },
  md: { label: "Markdown", Icon: FileText },
};

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// Saves the share in a format: PDF printed by the server, HTML and Markdown
// from the preview, fetched now when there isn't one in hand.
export function useShareDownload(
  request: PreviewRequest,
  title: string,
  preview?: SharePreview | null
) {
  const pdf = useSharePdf();
  const fetchPreview = useSharePreview();
  const choose = async (format: ShareFormat) => {
    try {
      if (format === "pdf") {
        save(await pdf.mutateAsync(request), fileName(title, "pdf"));
        return;
      }
      const p = preview ?? (await fetchPreview.mutateAsync(request));
      const md = format === "md";
      save(
        new Blob([md ? p.markdown : p.html], {
          type: md ? "text/markdown" : "text/html",
        }),
        fileName(title, format)
      );
    } catch (err) {
      toast.error(
        (err as Error).message ||
          (format === "pdf" ? "Couldn't make the PDF" : "Couldn't download it")
      );
    }
  };
  return { choose, pending: pdf.isPending || fetchPreview.isPending };
}

// One Download button for every format the server says it can make. PDF is
// printed server-side, so it shows a spinner; HTML and Markdown are in hand.
export function DownloadMenu({
  preview,
  formats = preview?.formats ?? [],
  request,
  title,
  disabled,
  trigger,
  align = "end",
}: {
  preview?: SharePreview | null;
  formats?: ShareFormat[];
  request: PreviewRequest;
  title: string;
  disabled: boolean;
  // The button that opens the menu, given whether a download is under way.
  trigger?: (pending: boolean) => ReactNode;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const { choose, pending } = useShareDownload(request, title, preview);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild disabled={disabled || !formats.length}>
        {trigger ? (
          trigger(pending)
        ) : (
          <Button
            variant="outline"
            className="min-h-11 flex-1 sm:flex-none"
            disabled={disabled || !formats.length || pending}
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {pending ? "Preparing…" : "Download"}
            <ChevronDown className="h-4 w-4 opacity-60" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-44">
        {formats.map((f) => {
          const { label, Icon } = FORMAT[f];
          return (
            <DropdownMenuItem
              key={f}
              className="min-h-11 gap-2"
              onSelect={() => void choose(f)}
            >
              <Icon className="h-4 w-4" />
              {label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
