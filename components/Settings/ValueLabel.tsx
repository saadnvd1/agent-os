import { cn } from "@/lib/utils";

/**
 * What a select trigger or item shows: a short label, and the resolved
 * value (a model id, say) under it in secondary text. Each line ends in an
 * ellipsis at the edge, never cut through a letter.
 */
export function ValueLabel({
  label,
  detail,
  className,
}: {
  label: string;
  detail?: string;
  className?: string;
}) {
  return (
    <span
      className={cn("flex min-w-0 flex-col text-left leading-tight", className)}
    >
      <span className="truncate">{label}</span>
      {detail && (
        <span className="text-muted-foreground truncate text-xs">{detail}</span>
      )}
    </span>
  );
}

// The trigger classes that let a ValueLabel use two lines.
export const TWO_LINE_TRIGGER =
  "h-auto min-h-11 py-1.5 md:min-h-9 [&>span]:line-clamp-none";
