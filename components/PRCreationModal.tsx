"use client";

import { useState, useEffect } from "react";
import {
  X,
  GitPullRequest,
  Loader2,
  ExternalLink,
  GitBranch,
  ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PRData {
  branch: string;
  baseBranch: string;
  existingPR: {
    number: number;
    url: string;
    state: string;
    title: string;
  } | null;
  commits: { hash: string; subject: string }[];
  suggestedTitle: string;
  suggestedBody: string;
}

interface PRCreationModalProps {
  workingDirectory: string;
  onClose: () => void;
  onSuccess?: (prUrl: string) => void;
}

export function PRCreationModal({
  workingDirectory,
  onClose,
  onSuccess,
}: PRCreationModalProps) {
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prData, setPrData] = useState<PRData | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  // Fetch PR data on mount
  useEffect(() => {
    const fetchPRData = async () => {
      try {
        const res = await fetch(
          `/api/git/pr?path=${encodeURIComponent(workingDirectory)}`
        );
        const data = await res.json();

        if (data.error) {
          setError(data.error);
        } else {
          setPrData(data);
          setTitle(data.suggestedTitle);
          setBody(data.suggestedBody);
        }
      } catch {
        setError("Failed to fetch PR data");
      } finally {
        setLoading(false);
      }
    };

    fetchPRData();
  }, [workingDirectory]);

  const handleCreate = async () => {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const res = await fetch("/api/git/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: workingDirectory,
          title: title.trim(),
          description: body,
          baseBranch: prData?.baseBranch,
        }),
      });

      const data = await res.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      if (data.pr?.url) {
        onSuccess?.(data.pr.url);
        // Open PR in new tab
        window.open(data.pr.url, "_blank");
        onClose();
      }
    } catch {
      setError("Failed to create PR");
    } finally {
      setCreating(false);
    }
  };

  // Show existing PR
  if (prData?.existingPR) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <Header onClose={onClose} />

        <div className="flex-1 flex flex-col items-center justify-center p-4">
          <GitPullRequest className="w-12 h-12 text-primary mb-4" />
          <h2 className="text-lg font-medium mb-2">PR Already Exists</h2>
          <p className="text-sm text-muted-foreground mb-4 text-center">
            #{prData.existingPR.number} - {prData.existingPR.title}
          </p>
          <Button
            variant="default"
            onClick={() => window.open(prData.existingPR!.url, "_blank")}
            className="min-h-[44px]"
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            View Pull Request
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <Header onClose={onClose} />

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : error && !prData ? (
        <div className="flex-1 flex flex-col items-center justify-center p-4">
          <p className="text-sm text-red-500 mb-4">{error}</p>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Branch info */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <GitBranch className="w-4 h-4" />
              <span>{prData?.branch}</span>
              <span>→</span>
              <span>{prData?.baseBranch}</span>
            </div>

            {/* Title input */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="PR title..."
                className={cn(
                  "w-full px-3 py-2 text-sm rounded-md",
                  "bg-muted/50 border border-border",
                  "focus:outline-none focus:ring-2 focus:ring-primary/50",
                  "min-h-[44px]"
                )}
              />
            </div>

            {/* Body textarea */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Describe your changes..."
                rows={12}
                className={cn(
                  "w-full px-3 py-2 text-sm rounded-md resize-none font-mono",
                  "bg-muted/50 border border-border",
                  "focus:outline-none focus:ring-2 focus:ring-primary/50"
                )}
              />
            </div>

            {/* Commits list */}
            {prData && prData.commits.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">
                  Commits ({prData.commits.length})
                </label>
                <div className="text-xs text-muted-foreground space-y-1">
                  {prData.commits.slice(0, 10).map((commit) => (
                    <div key={commit.hash} className="truncate">
                      <code className="text-primary/70">
                        {commit.hash.slice(0, 7)}
                      </code>{" "}
                      {commit.subject}
                    </div>
                  ))}
                  {prData.commits.length > 10 && (
                    <div className="text-muted-foreground/50">
                      +{prData.commits.length - 10} more commits
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Error message */}
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-border safe-area-bottom">
            <Button
              variant="default"
              onClick={handleCreate}
              disabled={creating || !title.trim()}
              className="w-full min-h-[44px]"
            >
              {creating ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <GitPullRequest className="w-4 h-4 mr-2" />
              )}
              Create Pull Request
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center gap-2 p-3 border-b border-border">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClose}
        className="h-9 w-9"
      >
        <ChevronLeft className="w-5 h-5" />
      </Button>
      <div className="flex-1">
        <h2 className="text-sm font-medium">Create Pull Request</h2>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClose}
        className="h-9 w-9 md:hidden"
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
}
