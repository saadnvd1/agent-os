"use client";

import { useStacksQuery } from "@/data/stacks";
import { StackCard } from "./StackCard";

// Stacks that are still going, then the last few that landed.
export function StacksSection() {
  const { data: stacks = [], isPending } = useStacksQuery();
  const open = stacks.filter((s) => s.status !== "landed");
  const landed = stacks.filter((s) => s.status === "landed").slice(0, 3);
  if (!isPending && !stacks.length) return null;

  return (
    <div className="space-y-2">
      <p className="label-mono text-muted-foreground pt-2">Stacks</p>
      {isPending && (
        <div className="bg-muted/40 h-24 animate-pulse rounded-xl" />
      )}
      {[...open, ...landed].map((s) => (
        <StackCard key={s.id} stack={s} />
      ))}
    </div>
  );
}
