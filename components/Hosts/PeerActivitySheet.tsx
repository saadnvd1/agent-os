"use client";

import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePeerAudit } from "@/data/peers";
import type { AuditRow, Outcome } from "@/lib/peer/audit";
import { relativeTime } from "@/lib/schedules/when";
import { cn } from "@/lib/utils";
import { SHEET } from "./sheet";

const REFUSED: Record<Exclude<Outcome, "ok">, string> = {
  denied_route: "route not open to it",
  bad_envelope: "malformed",
  too_large: "too large",
  too_slow: "too slow",
  busy: "busy",
  bad_sig: "bad signature",
  stale: "clocks differ",
  replay: "replayed",
  unknown_peer: "not linked",
  suspended: "suspended",
};

function Row({ row }: { row: AuditRow }) {
  const Arrow = row.direction === "in" ? ArrowDownLeft : ArrowUpRight;
  const refused = row.outcome !== "ok";
  return (
    <li className="flex items-start gap-2 py-2">
      <Arrow
        className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0"
        aria-label={row.direction === "in" ? "Called here" : "Called there"}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-xs">
          {row.method} {row.route}
        </p>
        <p className="text-muted-foreground text-xs">
          {relativeTime(row.at)}
          {row.count > 1 && ` · ${row.count} calls this hour`}
          {` · ${Math.round(row.ms)} ms`}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-md px-1.5 py-0.5 text-xs tabular-nums",
          refused
            ? "bg-destructive/10 text-destructive"
            : row.status >= 400
              ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
              : "bg-muted text-muted-foreground"
        )}
      >
        {refused ? REFUSED[row.outcome as Exclude<Outcome, "ok">] : row.status}
      </span>
    </li>
  );
}

/** Machines → a linked machine → Activity: every call, both ways. */
export function PeerActivitySheet({
  hostId,
  name,
  onClose,
}: {
  hostId: string | null;
  name: string;
  onClose: () => void;
}) {
  const { data: rows, isPending, error } = usePeerAudit(hostId);
  return (
    <Dialog open={!!hostId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn(SHEET, "max-h-[85vh] [&>*]:min-w-0")}>
        <DialogHeader>
          <DialogTitle>Activity with {name}</DialogTitle>
          <DialogDescription>
            Calls between this machine and {name} over the last 30 days. Reads
            repeated within an hour are counted on one line.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-1 max-h-[60vh] overflow-y-auto px-1">
          {isPending && hostId ? (
            <div className="space-y-2" aria-label="Loading">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="bg-muted/40 h-10 animate-pulse rounded-md"
                />
              ))}
            </div>
          ) : error ? (
            <p className="text-destructive text-sm">{error.message}</p>
          ) : !rows?.length ? (
            <p className="text-muted-foreground text-sm">No calls yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {rows.map((r, i) => (
                <Row key={`${r.at}-${i}`} row={r} />
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
