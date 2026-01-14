"use client";

import { useState } from "react";
import {
  GitCommit,
  GitBranch,
  Send,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CommitFormProps {
  workingDirectory: string;
  stagedCount: number;
  isOnMainBranch: boolean;
  branch: string;
  onCommit: () => void;
  onCreatePR?: () => void;
}

export function CommitForm({
  workingDirectory,
  stagedCount,
  isOnMainBranch,
  branch,
  onCommit,
  onCreatePR,
}: CommitFormProps) {
  const [message, setMessage] = useState("");
  const [branchName, setBranchName] = useState("");
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showCreatePR, setShowCreatePR] = useState(false);

  const canCommit = stagedCount > 0 && message.trim().length > 0;
  const needsBranch = isOnMainBranch && !branchName.trim();

  const handleCommit = async () => {
    if (!canCommit) return;
    if (isOnMainBranch && !branchName.trim()) {
      setError("Please enter a branch name");
      return;
    }

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
          branchName: isOnMainBranch ? branchName.trim() : undefined,
        }),
      });

      const data = await res.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      // Clear form
      setMessage("");
      setBranchName("");
      setSuccess("Committed successfully!");
      onCommit();
    } catch {
      setError("Failed to commit");
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
        setShowCreatePR(true);
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
    await handleCommit();
    // If commit was successful, push
    if (!error) {
      await handlePush();
    }
  };

  if (stagedCount === 0) {
    return null;
  }

  return (
    <div className="bg-muted/20 space-y-3 p-3">
      {/* Branch name input (if on main) */}
      {isOnMainBranch && (
        <div className="space-y-1.5">
          <label className="text-muted-foreground flex items-center gap-1 text-xs">
            <GitBranch className="h-3 w-3" />
            New branch name
          </label>
          <input
            type="text"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            placeholder="feature/my-feature"
            className={cn(
              "w-full rounded-md px-3 py-2 text-sm",
              "bg-muted/50",
              "focus:ring-primary/50 focus:ring-2 focus:outline-none",
              "placeholder:text-muted-foreground/50",
              "min-h-[44px]" // Mobile touch target
            )}
          />
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
          disabled={!canCommit || needsBranch || committing || pushing}
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
          disabled={!canCommit || needsBranch || committing || pushing}
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

      {/* Create PR button */}
      {showCreatePR && onCreatePR && (
        <Button
          variant="outline"
          size="default"
          className="text-primary min-h-[44px] w-full"
          onClick={() => {
            setShowCreatePR(false);
            onCreatePR();
          }}
        >
          <ExternalLink className="mr-1 h-4 w-4" />
          Create Pull Request
        </Button>
      )}
    </div>
  );
}
