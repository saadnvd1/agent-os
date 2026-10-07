"use client";

import { PenLine, X } from "lucide-react";
import { useSnapshot } from "valtio";
import { loadDraft } from "@/components/Chat/useDraft";
import { draftComposerKey, type Draft } from "@/lib/drafts";
import type { Project } from "@/lib/db";
import { draftsActions, draftsStore, newDraft } from "@/stores/drafts";

const firstLine = (text: string) => text.trim().split("\n")[0].slice(0, 80);

// Drafts with something typed in them, kept until sent or discarded: ⌥N
// makes a fresh draft rather than taking over one of these.
export function DraftShelf({ projects }: { projects: Project[] }) {
  const { drafts } = useSnapshot(draftsStore);
  const typed = (Object.values(drafts) as Draft[])
    .map((d) => ({ d, text: loadDraft(draftComposerKey(d.id))?.text ?? "" }))
    .filter((x) => x.text.trim())
    .sort((a, b) => b.d.createdAt - a.d.createdAt);
  if (!typed.length) return null;
  const projectName = (id: string | null) =>
    projects.find((p) => p.id === id)?.name ?? "Scratch";

  return (
    <section aria-label="Drafts" className="mb-2">
      <p className="text-muted-foreground px-2.5 pt-3 pb-1 text-[11px] font-medium">
        Drafts
      </p>
      {typed.map(({ d, text }) => (
        <div
          key={d.id}
          className="group hover:bg-foreground/[0.04] flex min-h-11 items-center rounded-lg md:min-h-9"
        >
          <button
            type="button"
            onClick={() => newDraft({ kind: "open", draftId: d.id })}
            className="flex min-w-0 flex-1 items-center gap-2.5 self-stretch px-2.5 text-left"
          >
            <PenLine className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{firstLine(text)}</span>
              <span className="text-muted-foreground block truncate text-xs">
                {d.openPr ? "Task · " : ""}
                {projectName(d.projectId)}
              </span>
            </span>
          </button>
          <button
            type="button"
            aria-label="Discard draft"
            onClick={() => draftsActions.remove(d.id)}
            className="text-muted-foreground hover:text-foreground flex h-11 w-11 shrink-0 items-center justify-center md:h-9 md:w-9 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 [@media(hover:none)]:md:h-11 [@media(hover:none)]:md:w-11 [@media(hover:none)]:md:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </section>
  );
}
