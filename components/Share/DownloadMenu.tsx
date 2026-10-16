"use client";

import { useState } from "react";
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

// One Download button for every format the server says it can make. PDF is
// printed server-side, so it shows a spinner; HTML and Markdown are in hand.
export function DownloadMenu({
  preview,
  request,
  title,
  disabled,
}: {
  preview: SharePreview | null;
  request: PreviewRequest;
  title: string;
  disabled: boolean;
}) {
  const pdf = useSharePdf();
  const [open, setOpen] = useState(false);
  const formats = preview?.formats ?? [];

  const choose = async (format: ShareFormat) => {
    if (!preview) return;
    if (format === "pdf") {
      try {
        save(await pdf.mutateAsync(request), fileName(title, "pdf"));
      } catch (err) {
        toast.error((err as Error).message || "Couldn't make the PDF");
      }
      return;
    }
    const md = format === "md";
    save(
      new Blob([md ? preview.markdown : preview.html], {
        type: md ? "text/markdown" : "text/html",
      }),
      fileName(title, format)
    );
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="min-h-11 flex-1 sm:flex-none"
          disabled={disabled || !formats.length || pdf.isPending}
        >
          {pdf.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {pdf.isPending ? "Making PDF…" : "Download"}
          <ChevronDown className="h-4 w-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
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
