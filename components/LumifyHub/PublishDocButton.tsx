"use client";

import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  useDocsWorkspace,
  usePublishDoc,
  usePublishedDocs,
} from "@/data/lumifyhub/docs";
import { isMarkdownPath } from "@/lib/lumifyhub/doc-tree";

// "Publish to LumifyHub" for a markdown file, when the project's workspace is
// linked. Publishing again updates the same page.
export function PublishDocButton({
  projectId,
  file,
  dirty,
}: {
  projectId?: string | null;
  file: string;
  dirty: boolean;
}) {
  const workspace = useDocsWorkspace(projectId);
  const markdown = isMarkdownPath(file);
  const { data: published = [] } = usePublishedDocs(
    projectId ?? null,
    !!workspace && markdown
  );
  const publish = usePublishDoc();
  if (!workspace || !projectId || !markdown) return null;
  const existing = published.find((d) => file.endsWith(`/${d.repoPath}`));

  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-11 shrink-0 sm:h-8"
      disabled={dirty || publish.isPending}
      title={dirty ? "Save the file first" : undefined}
      onClick={() =>
        publish.mutate(
          { projectId, path: file },
          {
            onSuccess: (doc) =>
              toast.success(
                existing ? "LumifyHub page updated" : "Published to LumifyHub",
                {
                  action: {
                    label: "Open",
                    onClick: () => window.open(doc.url, "_blank", "noopener"),
                  },
                }
              ),
            onError: (error) => toast.error(error.message),
          }
        )
      }
    >
      <Share2 className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">
        {publish.isPending
          ? "Publishing..."
          : existing
            ? "Update in LumifyHub"
            : "Publish to LumifyHub"}
      </span>
      <span className="sm:hidden">{existing ? "Update" : "Publish"}</span>
    </Button>
  );
}
