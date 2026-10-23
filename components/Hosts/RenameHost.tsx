"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Host } from "@/lib/db";
import { useRenameHost } from "@/data/hosts";

/** A name of the person's own for a machine, shown on every screen. */
export function RenameHost({
  host,
  onDone,
}: {
  host: Host;
  onDone: () => void;
}) {
  const rename = useRenameHost();
  const [name, setName] = useState(host.name);
  const save = () =>
    rename.mutate({ id: host.id, name }, { onSuccess: onDone });
  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label={`Name for ${host.name}`}
        maxLength={60}
        autoFocus
        className="h-11 min-w-0 flex-1 sm:h-9"
      />
      <Button
        type="submit"
        className="min-h-11 sm:min-h-9"
        disabled={rename.isPending || !name.trim()}
      >
        Save
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="min-h-11 sm:min-h-9"
        onClick={onDone}
      >
        Cancel
      </Button>
      {rename.error && (
        <p className="text-destructive w-full text-xs">
          {rename.error.message}
        </p>
      )}
    </form>
  );
}
