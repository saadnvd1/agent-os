import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { GitInfo } from "./NewSessionDialog.types";

interface WorktreeSectionProps {
  gitInfo: GitInfo;
  useWorktree: boolean;
  onUseWorktreeChange: (checked: boolean) => void;
  featureName: string;
  onFeatureNameChange: (value: string) => void;
  baseBranch: string;
  onBaseBranchChange: (value: string) => void;
}

export function WorktreeSection({
  gitInfo,
  useWorktree,
  onUseWorktreeChange,
  featureName,
  onFeatureNameChange,
  baseBranch,
  onBaseBranchChange,
}: WorktreeSectionProps) {
  if (!gitInfo.isGitRepo) return null;

  return (
    <div className="bg-accent/40 space-y-3 rounded-lg p-3">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="useWorktree"
          checked={useWorktree}
          onChange={(e) => onUseWorktreeChange(e.target.checked)}
          className="border-border bg-background accent-primary h-4 w-4 rounded"
        />
        <label
          htmlFor="useWorktree"
          className="cursor-pointer text-sm font-medium"
        >
          Create isolated worktree
        </label>
      </div>

      {useWorktree && (
        <div className="space-y-3 pl-6">
          <div className="space-y-1">
            <label className="text-muted-foreground text-xs">
              Feature Name
            </label>
            <Input
              value={featureName}
              onChange={(e) => onFeatureNameChange(e.target.value)}
              placeholder="add-dark-mode"
              className="h-8 text-sm"
            />
            {featureName && (
              <p className="text-muted-foreground text-xs">
                Branch: feature/
                {featureName
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-+|-+$/g, "")
                  .slice(0, 50)}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-muted-foreground text-xs">Base Branch</label>
            <Select value={baseBranch} onValueChange={onBaseBranchChange}>
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
  );
}
