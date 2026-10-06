"use client";

import { ArrowLeft, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GenericSkeletonLoader } from "@/components/ui/skeleton";
import { Markdown } from "@/components/Chat/Markdown";
import { useDoc } from "@/data/lumifyhub/docs";
import { docsUiActions } from "@/stores/docsUi";

export function DocReader({
  workspaceId,
  pageId,
}: {
  workspaceId: string;
  pageId: string;
}) {
  const { data: page, isPending, isError, error } = useDoc(workspaceId, pageId);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Clear of the dialog's close button. */}
      <div className="-mt-2 flex items-center gap-2 pr-8">
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0 sm:h-8 sm:w-8"
          aria-label="Back to docs"
          onClick={() => docsUiActions.read(null)}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h3 className="min-w-0 flex-1 truncate text-base font-medium">
          {page?.title ?? ""}
        </h3>
        {page && (
          <Button
            size="sm"
            variant="secondary"
            className="h-11 shrink-0 sm:h-8"
            asChild
          >
            <a href={page.url} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Open in LumifyHub</span>
              <span className="sm:hidden">Edit</span>
            </a>
          </Button>
        )}
      </div>
      <div className="min-h-40 flex-1 overflow-y-auto pr-1">
        {isPending && <GenericSkeletonLoader className="py-2" />}
        {isError && (
          <p className="text-destructive py-6 text-center text-sm">
            {error.message}
          </p>
        )}
        {page &&
          (page.content.trim() ? (
            <Markdown text={page.content} />
          ) : (
            <p className="text-muted-foreground py-8 text-center text-sm">
              This page is empty.
            </p>
          ))}
      </div>
    </div>
  );
}
