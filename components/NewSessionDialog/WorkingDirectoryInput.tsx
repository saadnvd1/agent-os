import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { GitBranch, Loader2, FolderOpen } from "lucide-react";
import type { GitInfo } from "./NewSessionDialog.types";

interface WorkingDirectoryInputProps {
  value: string;
  onChange: (value: string) => void;
  gitInfo: GitInfo | null;
  checkingGit: boolean;
  recentDirs: string[];
  onBrowse: () => void;
}

export function WorkingDirectoryInput({
  value,
  onChange,
  gitInfo,
  checkingGit,
  recentDirs,
  onBrowse,
}: WorkingDirectoryInputProps) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Working Directory</label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="~/projects/my-app"
          />
          {checkingGit && (
            <div className="absolute top-1/2 right-3 -translate-y-1/2">
              <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onBrowse}
          title="Browse directories"
        >
          <FolderOpen className="h-4 w-4" />
        </Button>
      </div>
      {gitInfo?.isGitRepo && (
        <p className="text-muted-foreground flex items-center gap-1 text-xs">
          <GitBranch className="h-3 w-3" />
          Git repo on {gitInfo.currentBranch}
        </p>
      )}
      {recentDirs.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {recentDirs.map((dir) => (
            <button
              key={dir}
              type="button"
              onClick={() => onChange(dir)}
              className="bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground max-w-[200px] truncate rounded-full px-2 py-0.5 text-xs transition-colors"
              title={dir}
            >
              {dir.replace(/^~\//, "").split("/").pop() || dir}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
