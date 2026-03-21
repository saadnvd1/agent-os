import { ThemeToggle } from "@/components/ThemeToggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function SidebarFooter() {
  return (
    <div className="mt-auto px-3 pt-2 pb-3">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">Theme</span>
        <ThemeToggle />
      </div>
      <div className="text-muted-foreground/50 mt-2 text-center text-[10px]">
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href="https://aterm.app"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-muted-foreground transition-colors"
            >
              aTerm
            </a>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>Desktop terminal workspace for AI coding agents</p>
          </TooltipContent>
        </Tooltip>
        <span className="mx-1.5">·</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href="https://lumifyhub.io"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-muted-foreground transition-colors"
            >
              LumifyHub
            </a>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="flex items-center gap-1.5">
              Team collaboration with chat and documentation
              <span className="bg-primary/15 text-primary rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                Sponsor
              </span>
            </p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
