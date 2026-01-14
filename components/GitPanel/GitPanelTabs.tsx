"use client";

import { cn } from "@/lib/utils";

export type GitTab = "changes" | "history";

interface GitPanelTabsProps {
  activeTab: GitTab;
  onTabChange: (tab: GitTab) => void;
}

export function GitPanelTabs({ activeTab, onTabChange }: GitPanelTabsProps) {
  return (
    <div className="border-border/50 flex border-b">
      <button
        onClick={() => onTabChange("changes")}
        className={cn(
          "flex-1 px-4 py-2 text-sm font-medium transition-colors",
          activeTab === "changes"
            ? "text-foreground border-primary border-b-2"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        Changes
      </button>
      <button
        onClick={() => onTabChange("history")}
        className={cn(
          "flex-1 px-4 py-2 text-sm font-medium transition-colors",
          activeTab === "history"
            ? "text-foreground border-primary border-b-2"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        History
      </button>
    </div>
  );
}
