"use client";

import { useMemo } from "react";
import { useSnapshot } from "valtio";
import { GitCompareArrows } from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useNow } from "@/components/Chat/useNow";
import { useClaims } from "@/data/claims";
import { claimsUi, claimsUiActions } from "@/stores/claimsUi";
import { cn } from "@/lib/utils";
import { ClaimRow } from "./ClaimRow";
import { QUIET_MS, focusView, groupByRepo, lastHeardText } from "./format";

const Skeleton = () => (
  <div className="space-y-2" aria-label="Loading claims">
    {[0, 1, 2].map((i) => (
      <div key={i} className="bg-muted/40 h-16 animate-pulse rounded-xl" />
    ))}
  </div>
);

// Work across machines: what each linked machine's sessions are on, the
// overlaps first, and when each machine was last heard from.
export function ClaimsSheet() {
  const snap = useSnapshot(claimsUi);
  const { data, isPending, isError, dataUpdatedAt } = useClaims({
    enabled: snap.open,
  });
  const tick = useNow(snap.open);
  const now = tick + (data ? data.now - dataUpdatedAt : 0);
  const view = useMemo(
    () => (data ? focusView(data, snap.focus ? [...snap.focus] : null) : null),
    [data, snap.focus]
  );
  const byId = useMemo(
    () => new Map((view?.claims ?? []).map((c) => [c.id, c])),
    [view]
  );
  const sharedOf = (id: string) =>
    new Set(
      (view?.overlaps ?? [])
        .filter((o) => o.a === id || o.b === id)
        .flatMap((o) => o.shared)
    );
  const here = data?.machine.id;

  return (
    <Dialog open={snap.open} onOpenChange={claimsUiActions.setOpen}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>Work across machines</DialogTitle>
          <DialogDescription className="sr-only">
            What sessions on this and linked machines are working on, and where
            the work overlaps.
          </DialogDescription>
        </DialogHeader>
        {isPending && <Skeleton />}
        {isError && (
          <p className="text-destructive text-sm">Couldn’t load claims.</p>
        )}
        {data && view && (
          <div className="space-y-4">
            <ul className="flex flex-wrap gap-2" aria-label="Machines">
              {data.machines.map((m) => {
                const quiet =
                  !m.self &&
                  (m.lastHeardAt === null || now - m.lastHeardAt > QUIET_MS);
                return (
                  <li
                    key={m.id}
                    className="bg-muted/40 flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
                  >
                    <span className="font-medium">{m.name}</span>
                    <span
                      className={cn(
                        "text-muted-foreground",
                        quiet && "text-amber-700 dark:text-amber-400"
                      )}
                    >
                      {lastHeardText(m.lastHeardAt, now)}
                    </span>
                  </li>
                );
              })}
            </ul>
            {snap.focus && (
              <button
                type="button"
                onClick={claimsUiActions.showAll}
                className="text-primary min-h-11 text-sm"
              >
                Showing one pair. Show all work
              </button>
            )}
            {view.overlaps.length > 0 && (
              <section className="space-y-2" aria-label="Overlaps">
                <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  Overlaps
                </h3>
                <ul className="space-y-2">
                  {view.overlaps.map((o) => {
                    const a = byId.get(o.a);
                    const b = byId.get(o.b);
                    if (!a || !b) return null;
                    return (
                      <li
                        key={`${o.a}|${o.b}`}
                        className="bg-muted/40 flex items-start gap-2 rounded-xl p-3 text-sm"
                      >
                        <StatusPill
                          tone={o.strength === "strong" ? "amber" : "muted"}
                        >
                          <GitCompareArrows
                            aria-hidden
                            className="h-2.5 w-2.5"
                          />
                          {o.strength}
                        </StatusPill>
                        <span className="min-w-0 flex-1 break-words">
                          {a.goal} on {a.originName} and {b.goal} on{" "}
                          {b.originName}
                          <span className="text-muted-foreground block text-xs">
                            {[
                              o.kinds.join(" + "),
                              o.shared.length
                                ? `${o.shared.length} shared file${o.shared.length === 1 ? "" : "s"}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            {view.claims.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                Nothing is claimed right now. Work shows up here while a session
                has changes in a repository.
              </p>
            ) : (
              groupByRepo(view.claims).map((g) => (
                <section key={g.repo} className="space-y-2" aria-label={g.repo}>
                  <h3 className="text-muted-foreground truncate text-xs font-semibold">
                    {g.repo}
                  </h3>
                  <ul className="space-y-2">
                    {g.claims.map((c) => (
                      <ClaimRow
                        key={c.id}
                        claim={c}
                        here={c.origin === here}
                        now={now}
                        shared={sharedOf(c.id)}
                      />
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
