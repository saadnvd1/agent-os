"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useClientConfig } from "@/data/client-config/queries";
import { useSetOwnerName } from "@/data/owner/mutations";

// The name AgentOS and the orchestrators use when they refer to you.
export function OwnerNameRow() {
  const saved = useClientConfig().data?.ownerName ?? "";
  // null: show what is saved.
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? saved;
  const save = useSetOwnerName();
  return (
    <form
      className="bg-muted/40 flex flex-col gap-2 rounded-lg px-3 py-2.5 sm:flex-row sm:items-center"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(value.trim() || null, { onSuccess: () => setDraft(null) });
      }}
    >
      <div className="min-w-0 flex-1">
        <label htmlFor="owner-name" className="text-sm font-medium">
          Your name
        </label>
        <p className="text-muted-foreground text-xs">
          Used where AgentOS and your orchestrators refer to you. Orchestrators
          pick it up when they next start.
        </p>
        {save.error && (
          <p className="text-destructive text-xs">{save.error.message}</p>
        )}
      </div>
      <Input
        id="owner-name"
        value={value}
        maxLength={40}
        placeholder="Not set"
        onChange={(e) => setDraft(e.target.value)}
        className="min-h-11 sm:min-h-8 sm:w-44"
      />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        className="min-h-11 sm:min-h-8"
        disabled={save.isPending || value.trim() === saved}
      >
        Save
      </Button>
    </form>
  );
}
