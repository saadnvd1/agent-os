"use client";

import { useState } from "react";
import {
  GitCommit,
  GitBranch,
  Send,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CommitFormProps {
  workingDirectory: string;
  stagedCount: number;
  branch: string;
  repoName?: string;
  multipleReposWarning?: boolean;
  onCommit: () => void;
}

export function CommitForm({
  workingDirectory,
  stagedCount,
  branch,
  repoName,
  multipleReposWarning,
  onCommit,
}: CommitFormProps) {
  const [message, setMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canCommit = stagedCount > 0 && message.trim().length > 0;

  const handleCommit = async (): Promise<boolean> => {
    if (!canCommit) return false;

    setError(null);
    setSuccess(null);
    setCommitting(true);

    try {
      const res = await fetch("/api/git/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: workingDirectory,
          message: message.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || "Commit failed");
        return false;
      }

      // Clear form
      setMessage("");
      setSuccess("Committed successfully!");
      onCommit();
      return true;
    } catch {
      setError("Failed to commit");
      return false;
    } finally {
      setCommitting(false);
    }
  };

  const handlePush = async () => {
    setError(null);
    setSuccess(null);
    setPushing(true);

    try {
      const res = await fetch("/api/git/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workingDirectory }),
      });

      const data = await res.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      if (data.pushed) {
        setSuccess("Pushed successfully!");
      } else {
        setSuccess(data.message || "Already up to date");
      }

      onCommit();
    } catch {
      setError("Failed to push");
    } finally {
      setPushing(false);
    }
  };

  const handleCommitAndPush = async () => {
    const commitSucceeded = await handleCommit();
    // Only push if commit was successful
    if (commitSucceeded) {
      await handlePush();
    }
  };

  // Only show commit form when there are staged files
  if (stagedCount === 0) {
    return null;
  }

  return (
    <div className="bg-muted/20 space-y-3 p-3">
      {/* Repo indicator (multi-repo mode) */}
      {repoName && (
        <div className="text-muted-foreground flex items-center gap-1 text-xs">
          <GitBranch className="h-3 w-3" />
          Committing to:{" "}
          <span className="text-foreground font-medium">{repoName}</span>
          <span className="text-muted-foreground/70">({branch})</span>
        </div>
      )}

      {/* Warning for multiple repos with staged changes */}
      {multipleReposWarning && (
        <div className="flex items-start gap-2 rounded-md bg-yellow-500/10 px-2 py-1.5 text-xs text-yellow-600 dark:text-yellow-500">
          <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
          <span>
            Multiple repos have staged changes. Only the first will be
            committed.
          </span>
        </div>
      )}

      {/* Commit message input */}
      <div className="space-y-1.5">
        <label className="text-muted-foreground flex items-center gap-1 text-xs">
          <GitCommit className="h-3 w-3" />
          Commit message
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Describe your changes..."
          rows={3}
          className={cn(
            "w-full resize-none rounded-md px-3 py-2 text-sm",
            "bg-muted/50",
            "focus:ring-primary/50 focus:ring-2 focus:outline-none",
            "placeholder:text-muted-foreground/50"
          )}
        />
      </div>

      {/* Error message */}
      {error && <p className="px-1 text-xs text-red-500">{error}</p>}

      {/* Success message */}
      {success && <p className="px-1 text-xs text-green-500">{success}</p>}

      {/* Buttons */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="default"
          onClick={handleCommit}
          disabled={!canCommit || committing || pushing}
          className="min-h-[44px] flex-1"
        >
          {committing ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <GitCommit className="mr-1 h-4 w-4" />
          )}
          Commit
        </Button>

        <Button
          variant="default"
          size="default"
          onClick={handleCommitAndPush}
          disabled={!canCommit || committing || pushing}
          className="min-h-[44px] flex-1"
        >
          {pushing ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-1 h-4 w-4" />
          )}
          Commit & Push
        </Button>
      </div>
    </div>
  );
}
