"use client";

import {
  Check,
  ChevronDown,
  FolderOpen,
  GitBranch,
  Package,
  ScrollText,
  ClipboardList,
  Terminal as TerminalIcon,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ViewMode } from "@/contexts/PaneContext";

export interface MobileView {
  mode: ViewMode;
  label: string;
  icon: LucideIcon;
  count?: number;
}

export interface MobileViewAvailability {
  isLocalSession: boolean;
  // Local, and the folder is not known to be outside a git repository.
  showGit: boolean;
  hasLog?: boolean;
  hasReport?: boolean;
  isConductor: boolean;
  workerCount: number;
}

// The one list of views on a phone; the picker renders it.
export function mobileViews({
  isLocalSession,
  showGit,
  hasLog,
  hasReport,
  isConductor,
  workerCount,
}: MobileViewAvailability): MobileView[] {
  const views: (MobileView | false)[] = [
    { mode: "terminal", label: "Chat", icon: TerminalIcon },
    isLocalSession && { mode: "files", label: "Files", icon: FolderOpen },
    showGit && { mode: "git", label: "Git", icon: GitBranch },
    { mode: "artifacts", label: "Artifacts", icon: Package },
    !!hasReport && { mode: "report", label: "Report", icon: ClipboardList },
    !!hasLog && { mode: "log", label: "Log", icon: ScrollText },
    isConductor && {
      mode: "workers",
      label: "Workers",
      icon: Users,
      count: workerCount,
    },
  ];
  return views.filter((v): v is MobileView => !!v);
}

export function MobileViewPicker({
  viewMode,
  onViewModeChange,
  ...availability
}: MobileViewAvailability & {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}) {
  const views = mobileViews(availability);
  const current = views.find((v) => v.mode === viewMode) ?? views[0];
  const CurrentIcon = current.icon;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`View: ${current.label}`}
          onClick={(e) => e.stopPropagation()}
          className="bg-accent/50 relative flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']"
        >
          <CurrentIcon className="h-4 w-4" />
          <span className="max-[359px]:hidden">{current.label}</span>
          <ChevronDown className="text-muted-foreground h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {views.map(({ mode, label, icon: Icon, count }) => (
          <DropdownMenuItem
            key={mode}
            aria-current={mode === current.mode}
            onSelect={() => onViewModeChange(mode)}
            className="h-11 gap-2"
          >
            <Icon className="h-4 w-4" />
            <span className="flex-1">{label}</span>
            {count !== undefined && (
              <span className="bg-primary/20 text-primary rounded px-1 text-[10px]">
                {count}
              </span>
            )}
            {mode === current.mode && <Check className="h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
