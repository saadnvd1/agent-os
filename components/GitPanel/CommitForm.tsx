"use client";

import { useState } from "react";
import { GitCommit, GitBranch, Send, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CommitFormProps {
  workingDirectory: string;
  stagedCount: number;
  isOnMainBranch: boolean;
  branch: string;
  onCommit: () => void;
}

export function CommitForm({
  workingDirectory,
  stagedCount,
  isOnMainBranch,
  branch,
  onCommit,
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
    <div className="border-t border-border p-3 space-y-3">
      {/* Branch name input (if on main) */}
      {isOnMainBranch && (
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground flex items-center gap-1">
            <GitBranch className="w-3 h-3" />
            New branch name
          </label>
          <input
            type="text"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            placeholder="feature/my-feature"
            className={cn(
              "w-full px-3 py-2 text-sm rounded-md",
              "bg-muted/50 border border-border",
              "focus:outline-none focus:ring-2 focus:ring-primary/50",
              "placeholder:text-muted-foreground/50",
              "min-h-[44px]" // Mobile touch target
            )}
          />
        </div>
      )}

      {/* Commit message input */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground flex items-center gap-1">
          <GitCommit className="w-3 h-3" />
          Commit message
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Describe your changes..."
          rows={3}
          className={cn(
            "w-full px-3 py-2 text-sm rounded-md resize-none",
            "bg-muted/50 border border-border",
            "focus:outline-none focus:ring-2 focus:ring-primary/50",
            "placeholder:text-muted-foreground/50"
          )}
        />
      </div>

      {/* Error message */}
      {error && (
        <p className="text-xs text-red-500 px-1">{error}</p>
      )}

      {/* Success message */}
      {success && (
        <p className="text-xs text-green-500 px-1">{success}</p>
      )}

      {/* Buttons */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="default"
          onClick={handleCommit}
          disabled={!canCommit || needsBranch || committing || pushing}
          className="flex-1 min-h-[44px]"
        >
          {committing ? (
            <Loader2 className="w-4 h-4 animate-spin mr-1" />
          ) : (
            <GitCommit className="w-4 h-4 mr-1" />
          )}
          Commit
        </Button>

        <Button
          variant="default"
          size="default"
          onClick={handleCommitAndPush}
          disabled={!canCommit || needsBranch || committing || pushing}
          className="flex-1 min-h-[44px]"
        >
          {pushing ? (
            <Loader2 className="w-4 h-4 animate-spin mr-1" />
          ) : (
            <Send className="w-4 h-4 mr-1" />
          )}
          Commit & Push
        </Button>
      </div>

      {/* Create PR button */}
      {showCreatePR && (
        <Button
          variant="outline"
          size="default"
          className="w-full min-h-[44px] text-primary"
          onClick={() => {
            // This will be connected to Phase 8
            setShowCreatePR(false);
          }}
        >
          <ExternalLink className="w-4 h-4 mr-1" />
          Create Pull Request
        </Button>
      )}
    </div>
  );
}
