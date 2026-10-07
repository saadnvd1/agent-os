"use client";

import type { Draft } from "@/lib/drafts";

const KEYS = [
  ["⌘N", "New session"],
  ["⌘⇧N", "Pick a project"],
  ["⌘⌥N", "Scratch chat"],
];

// What sending this draft starts, and the keys for the next one.
export function DraftHeading({
  draft,
  projectName,
}: {
  draft: Draft;
  projectName: string | null;
}) {
  const title = draft.openPr
    ? `New task in ${projectName}`
    : projectName
      ? `New session in ${projectName}`
      : "New chat";
  const detail = draft.openPr
    ? "An agent works on it alone in a fresh worktree and opens a pull request when it's done."
    : projectName
      ? draft.useWorktree
        ? "Nothing is made until you send. Then it gets its own worktree, set up before the agent starts."
        : "Nothing is made until you send. It works in the project's own folder."
      : "Nothing is made until you send. It works in a scratch folder.";
  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-end gap-2 px-4 py-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-muted-foreground text-sm">{detail}</p>
      <dl className="text-muted-foreground mt-2 hidden gap-x-4 gap-y-1 text-xs md:flex">
        {KEYS.map(([key, label]) => (
          <div key={key} className="flex items-center gap-1.5">
            <dt>
              <kbd className="bg-muted rounded px-1.5 py-0.5 font-mono">
                {key}
              </kbd>
            </dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
