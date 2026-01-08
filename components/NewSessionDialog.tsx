"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Plus, GitBranch, Loader2 } from "lucide-react";
import type { Group } from "@/lib/db";
import type { AgentType } from "@/lib/providers";

const SKIP_PERMISSIONS_KEY = "agentOS:skipPermissions";
const AGENT_TYPE_KEY = "agentOS:defaultAgentType";
const RECENT_DIRS_KEY = "agentOS:recentDirectories";
const MAX_RECENT_DIRS = 5;

interface GitInfo {
  isGitRepo: boolean;
  branches: string[];
  defaultBranch: string | null;
  currentBranch: string | null;
}

// Agent type options with display names
const AGENT_OPTIONS: { value: AgentType; label: string; description: string }[] = [
  { value: "claude", label: "Claude Code", description: "Anthropic's CLI" },
  { value: "codex", label: "Codex", description: "OpenAI's CLI" },
  { value: "opencode", label: "OpenCode", description: "Multi-provider CLI" },
];

interface NewSessionDialogProps {
  open: boolean;
  groups: Group[];
  onClose: () => void;
  onCreated: (sessionId: string) => void;
  onCreateGroup?: (name: string, parentPath?: string) => Promise<void>;
}

export function NewSessionDialog({
  open,
  groups,
  onClose,
  onCreated,
  onCreateGroup,
}: NewSessionDialogProps) {
  const [name, setName] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("~");
  const [groupPath, setGroupPath] = useState("sessions");
  const [isLoading, setIsLoading] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [agentType, setAgentType] = useState<AgentType>("claude");

  // Worktree state
  const [useWorktree, setUseWorktree] = useState(false);
  const [featureName, setFeatureName] = useState("");
  const [baseBranch, setBaseBranch] = useState("main");
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [checkingGit, setCheckingGit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recent directories
  const [recentDirs, setRecentDirs] = useState<string[]>([]);

  // Check if working directory is a git repo
  const checkGitRepo = useCallback(async (path: string) => {
    if (!path || path === "~") {
      setGitInfo(null);
      return;
    }

    setCheckingGit(true);
    try {
      const res = await fetch("/api/git/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const data = await res.json();
      setGitInfo(data);
      if (data.defaultBranch) {
        setBaseBranch(data.defaultBranch);
      }
    } catch {
      setGitInfo(null);
    } finally {
      setCheckingGit(false);
    }
  }, []);

  // Debounce git check when working directory changes
  useEffect(() => {
    const timer = setTimeout(() => {
      checkGitRepo(workingDirectory);
    }, 500);
    return () => clearTimeout(timer);
  }, [workingDirectory, checkGitRepo]);

  // Load preferences from localStorage
  useEffect(() => {
    const savedSkipPerms = localStorage.getItem(SKIP_PERMISSIONS_KEY);
    if (savedSkipPerms !== null) {
      setSkipPermissions(savedSkipPerms === "true");
    }
    const savedAgentType = localStorage.getItem(AGENT_TYPE_KEY);
    if (savedAgentType && ["claude", "codex", "opencode"].includes(savedAgentType)) {
      setAgentType(savedAgentType as AgentType);
    }
    // Load recent directories
    try {
      const saved = localStorage.getItem(RECENT_DIRS_KEY);
      if (saved) {
        setRecentDirs(JSON.parse(saved));
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  // Save directory to recent list
  const addRecentDirectory = useCallback((dir: string) => {
    if (!dir || dir === "~") return;
    setRecentDirs((prev) => {
      const filtered = prev.filter((d) => d !== dir);
      const updated = [dir, ...filtered].slice(0, MAX_RECENT_DIRS);
      localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Save skipPermissions preference to localStorage
  const handleSkipPermissionsChange = (checked: boolean) => {
    setSkipPermissions(checked);
    localStorage.setItem(SKIP_PERMISSIONS_KEY, String(checked));
  };

  // Save agentType preference to localStorage
  const handleAgentTypeChange = (value: AgentType) => {
    setAgentType(value);
    localStorage.setItem(AGENT_TYPE_KEY, value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate worktree requirements
    if (useWorktree) {
      if (!featureName.trim()) {
        setError("Feature name is required for worktree");
        return;
      }
      if (!gitInfo?.isGitRepo) {
        setError("Working directory must be a git repository");
        return;
      }
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined, // Let API auto-generate if empty
          workingDirectory,
          groupPath,
          agentType,
          // Worktree options
          useWorktree,
          featureName: useWorktree ? featureName.trim() : null,
          baseBranch: useWorktree ? baseBranch : null,
        }),
      });

      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      if (data.session) {
        // Save to recent directories
        addRecentDirectory(workingDirectory);

        setName("");
        setWorkingDirectory("~");
        setGroupPath("sessions");
        setUseWorktree(false);
        setFeatureName("");
        setError(null);
        onCreated(data.session.id);
      }
    } catch (err) {
      console.error("Failed to create session:", err);
      setError("Failed to create session");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim() || !onCreateGroup) return;
    await onCreateGroup(newGroupName.trim());
    setNewGroupName("");
    setShowNewGroup(false);
  };

  const handleClose = () => {
    setName("");
    setWorkingDirectory("~");
    setGroupPath("sessions");
    setShowNewGroup(false);
    setNewGroupName("");
    setUseWorktree(false);
    setFeatureName("");
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Session</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Agent</label>
            <Select value={agentType} onValueChange={(v) => handleAgentTypeChange(v as AgentType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGENT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <span className="font-medium">{option.label}</span>
                    <span className="text-muted-foreground ml-2 text-xs">{option.description}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Name <span className="text-muted-foreground font-normal">(optional)</span></label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Auto-generated if empty"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Working Directory</label>
            <div className="relative">
              <Input
                value={workingDirectory}
                onChange={(e) => setWorkingDirectory(e.target.value)}
                placeholder="~/projects/my-app"
              />
              {checkingGit && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
            {gitInfo?.isGitRepo && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <GitBranch className="w-3 h-3" />
                Git repo on {gitInfo.currentBranch}
              </p>
            )}
            {recentDirs.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {recentDirs.map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    onClick={() => setWorkingDirectory(dir)}
                    className="text-xs px-2 py-0.5 rounded-full bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors truncate max-w-[200px]"
                    title={dir}
                  >
                    {dir.replace(/^~\//, "").split("/").pop() || dir}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Worktree option - only show if it's a git repo */}
          {gitInfo?.isGitRepo && (
            <div className="space-y-3 p-3 rounded-lg bg-accent/40">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="useWorktree"
                  checked={useWorktree}
                  onChange={(e) => setUseWorktree(e.target.checked)}
                  className="h-4 w-4 rounded border-border bg-background accent-primary"
                />
                <label htmlFor="useWorktree" className="text-sm cursor-pointer font-medium">
                  Create isolated worktree
                </label>
              </div>

              {useWorktree && (
                <div className="space-y-3 pl-6">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Feature Name</label>
                    <Input
                      value={featureName}
                      onChange={(e) => setFeatureName(e.target.value)}
                      placeholder="add-dark-mode"
                      className="h-8 text-sm"
                    />
                    {featureName && (
                      <p className="text-xs text-muted-foreground">
                        Branch: feature/{featureName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50)}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Base Branch</label>
                    <Select value={baseBranch} onValueChange={setBaseBranch}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {gitInfo.branches.map((branch) => (
                          <SelectItem key={branch} value={branch}>
                            {branch}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Group</label>
            {showNewGroup ? (
              <div className="flex gap-2">
                <Input
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="New group name"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleCreateGroup();
                    } else if (e.key === "Escape") {
                      setShowNewGroup(false);
                      setNewGroupName("");
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCreateGroup}
                  disabled={!newGroupName.trim()}
                >
                  Add
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowNewGroup(false);
                    setNewGroupName("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Select value={groupPath} onValueChange={setGroupPath}>
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((group) => (
                      <SelectItem key={group.path} value={group.path}>
                        {group.path === "sessions" ? group.name : group.path.replace(/\//g, " / ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {onCreateGroup && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setShowNewGroup(true)}
                    title="Create new group"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="skipPermissions"
              checked={skipPermissions}
              onChange={(e) => handleSkipPermissionsChange(e.target.checked)}
              className="h-4 w-4 rounded border-border bg-background accent-primary"
            />
            <label htmlFor="skipPermissions" className="text-sm cursor-pointer">
              Skip permission prompts
              <span className="text-muted-foreground ml-1">
                {agentType === "claude" && "(--dangerously-skip-permissions)"}
                {agentType === "codex" && "(--approval-mode full-auto)"}
                {agentType === "opencode" && "(via config)"}
              </span>
            </label>
          </div>
          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || (useWorktree && !featureName.trim())}>
              {isLoading ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
