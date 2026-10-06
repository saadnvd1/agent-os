"use client";

import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDocsWorkspace } from "@/data/lumifyhub/docs";
import { docsUiActions } from "@/stores/docsUi";

// Only for a project whose workspace is linked to LumifyHub.
export function DocsButton({
  projectId,
  labelClassName,
}: {
  projectId?: string | null;
  labelClassName?: string;
}) {
  const workspace = useDocsWorkspace(projectId);
  if (!workspace) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label="Docs"
      title="Docs"
      className="h-7 px-2"
      onClick={() => docsUiActions.open(workspace.id)}
    >
      <BookOpen className="h-4 w-4" />
      <span className={labelClassName}>Docs</span>
    </Button>
  );
}
