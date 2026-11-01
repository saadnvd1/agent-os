import {
  FileCode,
  FileSpreadsheet,
  FileText,
  Loader2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  formatBytes,
  typeFor,
  type AttachmentKind,
} from "@/lib/attachments/policy";
import { cn } from "@/lib/utils";

const ICONS: Record<AttachmentKind, LucideIcon> = {
  image: FileText,
  pdf: FileText,
  sheet: FileSpreadsheet,
  doc: FileText,
  text: FileCode,
};

// A file attached to a message: in the composer (with a way to remove it,
// and a spinner while it uploads) and in the sent message.
export function FileChip({
  file,
  uploading,
  onRemove,
}: {
  file: { name: string; size: number };
  uploading?: boolean;
  onRemove?: () => void;
}) {
  const type = typeFor(file.name);
  const Icon = ICONS[type?.kind ?? "text"];
  const detail = uploading
    ? "Uploading…"
    : [formatBytes(file.size), type?.note].filter(Boolean).join(" · ");
  return (
    <div
      className={cn(
        "bg-foreground/[0.05] flex h-14 max-w-56 min-w-0 items-center gap-2 rounded-lg pl-3",
        onRemove ? "pr-1" : "pr-3"
      )}
      title={type?.note ? `${file.name} (${type.note})` : file.name}
    >
      {uploading ? (
        <Loader2 className="text-muted-foreground h-4 w-4 shrink-0 animate-spin" />
      ) : (
        <Icon className="text-muted-foreground h-4 w-4 shrink-0" />
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm">{file.name}</span>
        <span className="text-muted-foreground block truncate text-xs">
          {detail}
        </span>
      </span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${file.name}`}
          onClick={onRemove}
          className="text-muted-foreground hover:text-foreground flex h-11 w-11 shrink-0 items-center justify-center"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
