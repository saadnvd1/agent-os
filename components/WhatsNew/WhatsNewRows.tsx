import { StatusPill } from "@/components/ui/status-pill";
import type { Row } from "@/lib/whats-new/rows";
import { KIND_LABEL, type Kind } from "@/lib/whats-new/schema";

const TONE = { new: "primary", improved: "muted", fixed: "green" } as const;

export function KindChip({ kind }: { kind: Kind }) {
  return (
    <StatusPill
      tone={TONE[kind]}
      className="label-mono mt-0.5 w-[4.5rem] shrink-0 justify-center py-1 tracking-wider"
    >
      {KIND_LABEL[kind]}
    </StatusPill>
  );
}

export function WhatsNewRow({ row }: { row: Row }) {
  if (row.type === "day")
    return (
      <h3 className="label-mono text-muted-foreground bg-popover sticky top-0 z-10 px-4 pt-4 pb-1.5">
        {row.label}
      </h3>
    );
  if (row.type === "heading")
    return (
      <h3 className="label-mono text-primary px-4 pt-4 pb-1.5">{row.label}</h3>
    );
  if (row.type === "divider")
    return (
      <div className="text-primary my-2 flex items-center gap-3 px-4">
        <span className="bg-primary/30 h-px flex-1" />
        <span className="label-mono">{row.label}</span>
        <span className="bg-primary/30 h-px flex-1" />
      </div>
    );
  const { entry } = row;
  return (
    <div className="flex items-start gap-3 px-4 py-2">
      <KindChip kind={entry.kind} />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] leading-snug">{entry.text}</p>
        {entry.note && (
          <p className="text-muted-foreground mt-0.5 text-xs">{entry.note}</p>
        )}
      </div>
      {entry.url ? (
        <a
          href={entry.url}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`Pull request ${entry.id}`}
          className="text-muted-foreground hover:text-foreground -my-2 -mr-2 inline-flex min-h-11 min-w-11 items-center justify-center text-[11px] md:min-h-8 md:min-w-8"
        >
          #{entry.id}
        </a>
      ) : (
        <span className="text-muted-foreground text-[11px]">#{entry.id}</span>
      )}
    </div>
  );
}
