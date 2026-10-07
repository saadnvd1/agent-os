"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useInitProject, usePublishPrivate } from "@/data/projects";
import { ParentPicker } from "./ParentPicker";

// A new folder with git init and a first commit. Publishing it to GitHub is
// a separate, explicit click.
export function NameForm({
  hostId,
  onDone,
}: {
  hostId: string;
  onDone: (projectId: string) => void;
}) {
  const [name, setName] = useState("");
  const [parent, setParent] = useState("~");
  const init = useInitProject();
  const publish = usePublishPrivate();
  const made = init.data;

  if (made)
    return (
      <div className="space-y-3">
        <p className="text-sm">
          <span className="font-medium">{made.name}</span> is a git repository
          with its first commit.
        </p>
        {publish.data && (
          <a
            href={publish.data}
            target="_blank"
            rel="noreferrer"
            className="text-primary block truncate text-sm underline"
          >
            {publish.data}
          </a>
        )}
        {publish.error && (
          <p className="text-destructive text-sm">{publish.error.message}</p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          {!publish.data && (
            <Button
              variant="outline"
              className="h-11 flex-1 md:h-9"
              disabled={publish.isPending}
              onClick={() => publish.mutate(made.id)}
            >
              {publish.isPending ? "Publishing…" : "Create private GitHub repo"}
            </Button>
          )}
          <Button
            className="h-11 flex-1 md:h-9"
            onClick={() => onDone(made.id)}
          >
            Start a session
          </Button>
        </div>
      </div>
    );

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        init.mutate({ hostId, parent, name: name.trim() });
      }}
    >
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="my-project"
        aria-label="Project name"
        className="h-11 md:h-9"
      />
      <ParentPicker hostId={hostId} path={parent} onChange={setParent} />
      {init.error && (
        <p className="text-destructive text-sm">{init.error.message}</p>
      )}
      <Button
        type="submit"
        className="h-11 w-full md:h-9"
        disabled={init.isPending || !name.trim()}
      >
        {init.isPending ? "Creating…" : "Create"}
      </Button>
    </form>
  );
}
